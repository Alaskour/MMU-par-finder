import { DateString, dateToString } from "../components/dateFormatter"; // опечатка исправлена

type Schedule = {
  kindOfWork: string;
  auditorium: string;
  date: DateString;
  dayOfWeekString: number;
  discipline: string;
  beginLesson: string;
  endLesson: string;
  lecturer: string;
  lecturerEmail: string | null;
  lecturer_title: string;
  lecturer_rank: string;
};

interface ApiErrorResponse {
  error: string;
}

export async function parseSchedule(
  id: number = 558,
  startDate: Date = new Date(2026, 5, 21),
  finishDate: Date = new Date(2026, 11, 31)
): Promise<Schedule[]> {
  const startStr = dateToString(startDate);
  const finishStr = dateToString(finishDate);

  const res = await fetch(
    `https://schedule.mi.university/api/schedule/group/${id}?start=${startStr}&finish=${finishStr}&lng=1`,
    {
      headers: {
        Authorization: `Basic bW11MjAyMzptbXUyMDIz` // вынести в env
      }
    }
  );

  const rawData: unknown = await res.json();

  if (rawData && typeof rawData === 'object' && 'error' in rawData) {
    throw new Error((rawData as ApiErrorResponse).error);
  }

  const data = rawData as any[];

  const schedule: Schedule[] = data.map(item => ({
    dayOfWeekString: item.dayOfWeekString,
    discipline: item.discipline,
    auditorium: item.auditorium,
    kindOfWork: item.kindOfWork,
    date: item.date,
    beginLesson: item.beginLesson,
    endLesson: item.endLesson,
    lecturer: item.lecturer,
    lecturerEmail: item.lecturerEmail,
    lecturer_title: item.lecturer_title,
    lecturer_rank: item.lecturer_rank
  }));

  return schedule; // возвращаем ОТФИЛЬТРОВАННЫЕ данные
}

export async function getScheduleByWeek(
  id: number = 558,
  date: Date = new Date()
): Promise<Schedule[]> {
  // Рассчитываем понедельник и воскресенье для переданной даты
  const monday = new Date(date);
  const dayOfWeek = monday.getDay(); // 0 - вс, 1 - пн, ...
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  monday.setDate(monday.getDate() - diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return await parseSchedule(id, monday, sunday);
}

// Пример использования
parseSchedule().then(data => console.log(data));