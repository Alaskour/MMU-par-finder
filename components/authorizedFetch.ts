import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import * as fs from 'fs';

// -------------------- Типы --------------------
export interface MoodleClientOptions {
  baseURL: string;
  cookiePath?: string;
}

interface LoginPageData {
  token: string;
  captchaQuestion: string;
}

export interface PageResponse {
  html: string;
  $: CheerioAPI;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JSONResponse = any;

// -------------------- Класс --------------------
export class MoodleClient {
  private readonly baseURL: string;
  private readonly cookiePath?: string;
  private readonly jar: CookieJar;
  private readonly client: AxiosInstance;
  private sesskey: string | null = null;

  constructor(options: MoodleClientOptions) {
    this.baseURL = options.baseURL;
    this.cookiePath = options.cookiePath;
    if (this.cookiePath && fs.existsSync(this.cookiePath)) {
      const raw = fs.readFileSync(this.cookiePath, 'utf-8');
      this.jar = CookieJar.deserializeSync(raw);
    } else {
      this.jar = new CookieJar();
    }
    this.client = this.#createClient();
  }

  // Приватный метод создания axios-инстанса
  #createClient(): AxiosInstance {
    // Библиотека axios-cookiejar-support расширяет конфиг свойством 'jar',
    // которое не описано в типах. Приводим объект к any для совместимости.
    const config = {
      jar: this.jar,
      withCredentials: true,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.9',
        Origin: this.baseURL,
        Referer: `${this.baseURL}/login/index.php`,
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
      validateStatus: (status: number) =>
        (status >= 200 && status < 400) || status === 303,
    };

    // Явное приведение к any решает конфликт типов
    return wrapper(axios.create(config as any));
  }

  // Сохранение cookies в файл
  #saveCookies(): void {
    if (this.cookiePath) {
      const serialized = JSON.stringify(this.jar.serializeSync(), null, 2);
      fs.writeFileSync(this.cookiePath, serialized, 'utf-8');
    }
  }

  // Извлечение sesskey из HTML (заточен под M.cfg.sesskey)
  #extractSesskey(html: string): string | null {
    const match = /"sesskey"\s*:\s*"([^"]+)"/.exec(html);
    return match ? match[1] : null;
  }

  // Загрузка страницы логина и извлечение CSRF-токена и вопроса капчи
  async #fetchLoginPage(): Promise<LoginPageData> {
    const { data } = await this.client.get<string>(
      `${this.baseURL}/login/index.php`
    );
    const $ = cheerio.load(data);

    const token = $('input[name="logintoken"]').val() as string | undefined;
    if (!token) throw new Error('logintoken не найден');

    // Извлекаем текст капчи
    const answerInput = $('input[name="answer"]');
    let questionText = '';
    if (answerInput.length) {
      // У cheerio нет прямого доступа к previousSibling, используем any для DOM-узла
      const rawElement = answerInput[0] as any;
      const prevNode = rawElement?.previousSibling;
      if (prevNode && prevNode.type === 'text') {
        questionText = (prevNode.data || '').trim();
      }
      // Если не нашли, берём родительский блок
      if (!questionText) {
        questionText = answerInput
          .closest('.form-group, .fitem')
          .text()
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    if (!questionText)
      throw new Error('Не удалось извлечь текст капчи');

    return { token, captchaQuestion: questionText };
  }

  // Решение арифметической капчи
  #evaluateCaptcha(question: string): number {
    const match = question.match(/(\d+)\s*([+\-])\s*(\d+)/);
    if (!match)
      throw new Error(`Не удалось распознать выражение: "${question}"`);
    const a = parseInt(match[1], 10);
    const b = parseInt(match[3], 10);
    return match[2] === '+' ? a + b : a - b;
  }

  // Вход в систему
  async #login(username: string, password: string): Promise<void> {
    const { token, captchaQuestion } = await this.#fetchLoginPage();
    console.log('Капча-вопрос:', captchaQuestion);
    const answer = this.#evaluateCaptcha(captchaQuestion);
    console.log('Ответ:', answer);

    const params = new URLSearchParams({
      logintoken: token,
      username,
      password,
      answer: String(answer),
    });

    let { data } = await this.client.post<string>(
      `${this.baseURL}/login/index.php`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    // Обработка страницы-заглушки с редиректом
    const $ = cheerio.load(data);
    const redirectLink = $(
      'a:contains("Продолжить"), a[href*="/my/"]'
    ).attr('href');
    if (redirectLink && !data.includes('sesskey')) {
      ({ data } = await this.client.get<string>(
        new URL(redirectLink, this.baseURL).href
      ));
    }

    this.sesskey = this.#extractSesskey(data);
    if (!this.sesskey) {
      throw new Error('Не удалось извлечь sesskey после входа');
    }
    console.log('Успешный вход, sesskey:', this.sesskey);
    this.#saveCookies();
  }

  // Проверка активности сессии (отсутствие формы логина на /my/)
  async #checkSession(): Promise<boolean> {
    try {
      const { data } = await this.client.get<string>(`${this.baseURL}/my/`);
      const $ = cheerio.load(data);
      return $('input[name="logintoken"]').length === 0;
    } catch {
      return false;
    }
  }

  // -------------------- Публичные методы --------------------

  // Гарантирует активную сессию (при необходимости выполняет вход)
  async ensureSession(username: string, password: string): Promise<void> {
    if (await this.#checkSession()) {
      console.log('Сессия активна');
    } else {
      console.log('Выполняем вход...');
      await this.#login(username, password);
    }
  }

  // GET-запрос с автоматическим парсингом HTML
  async getPage(path: string): Promise<PageResponse> {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    const { data } = await this.client.get<string>(url);
    return { html: data, $: cheerio.load(data) };
  }

  // POST-запрос с автоматической подстановкой sesskey
  async postForm(
    path: string,
    formData: Record<string, string> = {}
  ): Promise<PageResponse> {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    if (this.sesskey && !('sesskey' in formData)) {
      formData.sesskey = this.sesskey;
    }
    const params = new URLSearchParams(formData);
    const { data } = await this.client.post<string>(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return { html: data, $: cheerio.load(data) };
  }

  // Универсальный JSON-запрос (для AJAX-сервисов Moodle)
  async getJSON(
    path: string,
    method: 'get' | 'post' = 'get',
    payload?: unknown
  ): Promise<JSONResponse> {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    const config: AxiosRequestConfig = {
      headers: { 'Content-Type': 'application/json' },
    };
    const response =
      method === 'post'
        ? await this.client.post(url, payload, config)
        : await this.client.get(url, { ...config, params: payload });
    return response.data;
  }
}

// -------------------- Пример использования --------------------
(async () => {
  const client = new MoodleClient({
    baseURL: 'https://elearn.mmu.ru',
    cookiePath: './moodle_cookies.json',
  });

  await client.ensureSession('s434084', 'eHBhG5tua!XG');

  const { $ } = await client.getPage('/my/');
  console.log('Заголовок страницы:', $('title').text());
})();