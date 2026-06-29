export type DateString = `${number}.${number}.${number}` | string;

export function dateToString(date: Date): DateString {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()) .padStart(2, '0');

    return `${y}.${m}.${d}` as DateString;
}

export function stringToDate(date: DateString): Date {
    const parts: string[] = date.split(".");
    if (parts.length != 3) throw new Error('Неверный формат, ожидается ГГГГ.ММ.ДД');

    const year: number = parseInt(parts[0], 10)
    const month: number = parseInt(parts[1], 10) - 1
    const day: number = parseInt(parts[2], 10)

    return new Date(year, month, day, 3) // 3 часа добавил из-за Москвы
}

