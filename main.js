const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { datesAndNames } = require("./shedule.json");
require("dotenv").config();

async function extractAndSaveLink(parTitle) {
  if (!parTitle) {
    console.log("Предмет не указан.");
    return;
  }

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 10,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  try {
    console.log('Переход на страницу авторизации...');
    await page.goto('https://elearn.mmu.ru/login/index.php/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Решение капчи
    const math = await page.evaluate(() => {
      const element = document.querySelector('div.form-group:has(input[name="answer"])');
      return element?.textContent?.trim();
    });
    const mathResult = answerMath(math);
    console.log("Результат математики:", mathResult);

    // Заполнение формы (логин и пароль – проверьте имена переменных в .env)
    await page.type('input[name=username]', process.env.LOGIN);
    await page.type('input[name=password]', process.env.PASSWORD);
    await page.type('input[name=answer]', String(mathResult));
    await page.click('button[type=submit]');

    // Переход на "Мои дисциплины"
    console.log('Переход на мои дисциплины...');
    await new Promise(resolve => setTimeout(resolve, 175));

    await page.goto('https://elearn.mmu.ru/blocks/course_summary/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await new Promise(resolve => setTimeout(resolve, 175));

    // Парсинг дисциплин
    const disciplines = await page.evaluate(() => {
      const assObj = {};
      const discElements = document.querySelectorAll("a[title*='часть']");
      for (const elem of discElements) {
        const fullTitle = elem.textContent.trim();
        const bracketIndex = fullTitle.indexOf('(');
        if (bracketIndex === -1) continue;
        const cleanTitle = fullTitle.substring(0, bracketIndex).trim();
        assObj[cleanTitle] = elem.href;
      }
      return assObj;
    });


    console.log(`Переход на "${parTitle}"...`);
    try {
      await page.goto(disciplines[parTitle], {
        waitUntil: 'networkidle2', // Ждём полной загрузки всех ресурсов
        timeout: 30000 // 
      });
    } catch (err) {
      console.error('Ошибка при переходе на страницу дисциплины:', err);
      await browser.close();
      return;
    }

    // Дожидаемся появления элемента занятия
    try {
      await page.waitForSelector(
        '[data-activityname*="Лекционные занятия"], [data-activityname*="Семинарские занятия"]',
        { timeout: 15000 }
      );
    } catch (err) {
      console.log('Элемент занятия не найден за 15 секунд');
    }

    // Поиск ссылки на занятие
    const link = await page.evaluate(() => {
      const activity = document.querySelector(
        '[data-activityname*="Лекционные занятия"], [data-activityname*="Семинарские занятия"]'
      );
      if (activity) {
        const linkEl = activity.querySelector('a.aalink');
        if (linkEl) {
          console.log('Ссылка на занятие:', linkEl.href);
          return linkEl.href;
        }
        console.log('Ссылка не найдена внутри элемента');
      } else {
        console.log('Занятие не найдено');
      }
      return undefined;
    });

    if (!link) {
      console.log("Пара не найдена, завершение.");
      await browser.close();
      return;
    }

    // Клик по ссылке на страницу описания занятия
    await page.click(`a[href='${link}']`);

    // Ждём появления ссылки на вебинар (элемент div.urlworkaround a)
    try {
      await page.waitForSelector('div.urlworkaround a', { timeout: 15000 });
      console.log('Текущий URL:', page.url());
    } catch (err) {
      console.log('Не удалось загрузить страницу описания занятия (элемент не найден)');
      await browser.close();
      return;
    }

    // Извлекаем ссылку на вебинар
    const webinarLink = await page.$eval('div.urlworkaround a', el => el.href).catch(() => null);
    if (!webinarLink) {
      console.log("Ссылка на вебинар не найдена на странице описания");
      await browser.close();
      return;
    }
    console.log('Ссылка на пару:', webinarLink);

    // Сохраняем результат
    fs.writeFileSync(path.join(__dirname, 'link.txt'), webinarLink, 'utf-8');
    console.log('Ссылка сохранена в link.txt');

  } catch (error) {
    console.error('Ошибка:', error);
    console.error('Стек ошибки:', error.stack);
  } finally {
    console.log('Браузер закрыт');
    await browser.close();
  }
}

// Вычисление математического примера
function answerMath(math) {
  const expression = math.replace(/[^\d+\-*/]/g, '');
  return eval(expression); // для доверенного ввода
}

// Поиск сегодняшней пары в shedule.json
function findTodayParName() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  const todayString = `${day}.${month}.${year}`;

  for (const elem of datesAndNames) {
    if (elem.date === todayString) return elem.name;
  }
  return null;
}

// Планировщик
function startDailyTask(hour, minute, task) {
  function schedule() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (target < now) target.setDate(target.getDate() + 1);
    const delay = target - now;
    setTimeout(() => {
      task(findTodayParName());
      schedule();
    }, delay);
  }
  schedule();
}

// Запуск
const todayPar = findTodayParName();
console.log('Сегодняшняя пара:', todayPar);
if (todayPar) extractAndSaveLink(todayPar);

// Расписание
startDailyTask(17, 10, extractAndSaveLink);
startDailyTask(18, 30, extractAndSaveLink);