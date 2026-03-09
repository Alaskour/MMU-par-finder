const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
// const { setTimeout } = require('timers');
const { datesAndNames } = require("./shedule.json");
const env = require("dotenv");

async function extractAndSaveLink(parTitle) {

  if (parTitle == undefined) return console.log("Предмет не указан.");

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 5, // замедлить действия (мс), полезно для отладки
    // args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });


  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const newPage = await target.page();
      console.log('Новая вкладка открыта!');

      // Ждём загрузки новой вкладки
      await newPage.waitForNavigation({ waitUntil: 'networkidle2' });

      // Получаем URL новой вкладки
      console.log('URL новой вкладки:', newPage.url());
    }
  });


  try {
    console.log('Переход на страницу авторизации...');

    // 1. Переход на страницу авторизации
    await page.goto('https://elearn.mmu.ru/login/index.php/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000 // Срок жизни страницы
    });




    // 2. Нахождение примера
    const math = await page.evaluate(() => {
      const element = document.querySelector('div.form-group:has(input[name="answer"])');
      return element?.textContent?.trim();
    });

    console.log("Результат математики: " + answerMath(math));

    // 3. Заполнение полей
    await page.type('input[name=username]', process.env.PASSWORD);
    await page.type('input[name=password]', process.env.LOGIN);
    await page.type('input[name=answer]', `${answerMath(math)}`);

    await page.click('button[type=submit]')


    // 3. 
    await new Promise(resolve => setTimeout(resolve, 175));
    console.log('Переход на мои дисциплины...');
    await page.goto('https://elearn.mmu.ru/blocks/course_summary/index.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30000 // Срок жизни страницы
    });

    const disciplines = await page.evaluate(() => {
      let assObj = {};
      const discElements = document.querySelectorAll("a[title*='часть']");

      for (elem of discElements) {
        const ueban = elem.textContent;
        const horoshiy = ueban.substring(0, ueban.indexOf("(") - 1);
        assObj[horoshiy] = elem.href;
      }

      return assObj
    });


    console.log(`Переход на ${parTitle}...`);
    await page.goto(disciplines[parTitle], {
      waitUntil: 'domcontentloaded',
      timeout: 30000 // Срок жизни страницы
    });

    const link = await page.evaluate(() => {

      const activity = document.querySelector('[data-activityname*="Лекционные занятия"], [data-activityname*="Семинарские занятия"]');
      if (activity) {
        const linkEl = activity.querySelector('a.aalink');
        if (linkEl) {
          console.log('Ссылка на занятие:', linkEl.href);
        return linkEl.href
        } else {
          console.log('Ссылка не найдена внутри элемента');
        }
      } else {
        console.log('Занятие не найдено');
      }
        return undefined
    });

    if (link === undefined) return console.log("Пара не найдена, пока!");


    await page.click(`a[href='${link}']`);
    console.log("Ссылка на переадрес на пару: " + link)
    await new Promise(resolve => setTimeout(resolve, 1000));




    fs.writeFileSync(path.join(__dirname, 'link.txt'), page.url() + "", 'utf-8');
    console.log('Ссылка сохранена в link.txt');
    console.log('Финальный URL:', page.url());





  } catch (error) {
    console.error('Ошибка:', error);
    console.error('Стек ошибки:', error.stack);
  } finally {
    // Закрытие браузера
    console.log('Браузер закрыт');
    await browser.close();
  }
}

// Расчет примера
function answerMath(math) {
  const expression = math.replace(/[^\d+\-*/]/g, '');
  // ОПАСНО: eval выполняет любой код JavaScript
  const result = eval(expression);
  return result;
}

function findTodayParName() {
  // Получаем сегодняшнюю дату в формате ДД.ММ.ГГГГ
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  const todayString = `${day}.${month}.${year}`;

  // Возврат названия текущей пары
  for (elem of datesAndNames) {
    if (elem.date === todayString) return elem.name;
    else return
  }
}

function startDailyTask(hour, minute, task) {
  function schedule() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);

    if (target < now) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target - now;
    setTimeout(() => {
      task(findTodayParName());
      schedule(); // планируем следующий запуск
    }, delay);
  }

  schedule();
}
extractAndSaveLink("Математический анализ")
startDailyTask(17, 10, extractAndSaveLink)
startDailyTask(18, 30, extractAndSaveLink)