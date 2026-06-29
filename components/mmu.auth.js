const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const fs = require('fs');

export class MoodleClient {
  constructor(baseURL, cookiePath) {
    this.baseURL = baseURL;
    this.cookiePath = cookiePath;
    this.jar = cookiePath && fs.existsSync(cookiePath)
      ? CookieJar.deserializeSync(fs.readFileSync(cookiePath, 'utf-8'))
      : new CookieJar();
    this.client = this.#createClient();
    this.sesskey = null;
  }

  // Приватный метод – настройка axios
  #createClient() {
    return wrapper(axios.create({
      jar: this.jar,
      withCredentials: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'ru,en;q=0.9',
        'Origin': this.baseURL,
        'Referer': `${this.baseURL}/login/index.php`,
        'Cache-Control': 'no-cache',
      },
      maxRedirects: 5,
      validateStatus: status => (status >= 200 && status < 400) || status === 303,
    }));
  }

  // Сохранение cookies в файл
  #saveCookies() {
    if (this.cookiePath) {
      fs.writeFileSync(this.cookiePath, JSON.stringify(this.jar.serializeSync(), null, 2));
    }
  }

  // Извлечение sesskey из HTML (заточен под структуру M.cfg)
  #extractSesskey(html) {
    const match = html.match(/"sesskey"\s*:\s*"([^"]+)"/);
    return match ? match[1] : null;
  }

  // Получение страницы логина и необходимых полей
  async #fetchLoginPage() {
    const { data } = await this.client.get(`${this.baseURL}/login/index.php`);
    const $ = cheerio.load(data);

    const token = $('input[name="logintoken"]').val();
    if (!token) throw new Error('logintoken не найден');

    // Вопрос капчи: обычно в тексте перед input
    const answerInput = $('input[name="answer"]');
    const questionText = answerInput.length
      ? answerInput[0].prev?.data?.trim() || answerInput.closest('.form-group, .fitem').text().replace(/\s+/g, ' ').trim()
      : '';
    if (!questionText) throw new Error('Не удалось извлечь текст капчи');

    return { token, captchaQuestion: questionText };
  }

  // Решение капчи
  #evaluateCaptcha(question) {
    const match = question.match(/(\d+)\s*([+\-])\s*(\d+)/);
    if (!match) throw new Error(`Не удалось распознать выражение: "${question}"`);
    const a = parseInt(match[1], 10);
    const b = parseInt(match[3], 10);
    return match[2] === '+' ? a + b : a - b;
  }

  // Выполнение входа
  async #login(username, password) {
    const { token, captchaQuestion } = await this.#fetchLoginPage();
    console.log('Капча-вопрос:', captchaQuestion);
    const answer = this.#evaluateCaptcha(captchaQuestion);
    console.log('Ответ:', answer);

    const params = new URLSearchParams({
      logintoken: token,
      username,
      password,
      answer,
    });

    let { data } = await this.client.post(`${this.baseURL}/login/index.php`, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    // Если есть страница-заглушка с редиректом
    const $ = cheerio.load(data);
    const redirectLink = $('a:contains("Продолжить"), a[href*="/my/"]').attr('href');
    if (redirectLink && !data.includes('sesskey')) {
      ({ data } = await this.client.get(new URL(redirectLink, this.baseURL).href));
    }

    this.sesskey = this.#extractSesskey(data);
    if (!this.sesskey) throw new Error('Не удалось извлечь sesskey после входа');
    console.log('Успешный вход, sesskey:', this.sesskey);
    this.#saveCookies();
  }

  // Проверка активности сессии
  async #checkSession() {
    try {
      const { data } = await this.client.get(`${this.baseURL}/my/`);
      return !cheerio.load(data)('input[name="logintoken"]').length;
    } catch {
      return false;
    }
  }

  // Публичный метод: гарантирует живую сессию
  async ensureSession(username, password) {
    if (await this.#checkSession()) {
      console.log('Сессия активна');
    } else {
      console.log('Выполняем вход...');
      await this.#login(username, password);
    }
  }

  // GET-запрос с парсингом
  async getPage(path) {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    const { data } = await this.client.get(url);
    return { html: data, $: cheerio.load(data) };
  }

  // POST-запрос (автоматически добавляет sesskey)
  async postForm(path, formData = {}) {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    if (this.sesskey && !('sesskey' in formData)) {
      formData.sesskey = this.sesskey;
    }
    const params = new URLSearchParams(formData);
    const { data } = await this.client.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return { html: data, $: cheerio.load(data) };
  }

  // JSON-запрос (для AJAX)
  async getJSON(path, method = 'get', data = null) {
    const url = path.startsWith('http') ? path : `${this.baseURL}${path}`;
    const config = { headers: { 'Content-Type': 'application/json' } };
    const response = method.toLowerCase() === 'post'
      ? await this.client.post(url, data, config)
      : await this.client.get(url, { params: data });
    return response.data;
  }
}

// ---------- Использование ----------
(async () => {
  const client = new MoodleClient('https://elearn.mmu.ru', './moodle_cookies.json');
  await client.ensureSession('s434084', 'eHBhG5tua!XG');

  const { $ } = await client.getPage('/my/');
  console.log('Заголовок страницы:', $('title').text());
})();