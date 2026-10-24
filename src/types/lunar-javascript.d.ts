declare module 'lunar-javascript' {
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar
    static fromDate(date: Date): Solar
    getYear(): number
    getMonth(): number
    getDay(): number
    toYmd(): string
    getLunar(): Lunar
  }

  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar
    static fromDate(date: Date): Lunar
    getSolar(): Solar
    getYear(): number
    getMonth(): number
    getDay(): number
    /** 该农历日期前后的节气表，键含中文节气名（立春/清明…） */
    getJieQiTable(): Record<string, Solar>
  }

  export class LunarYear {
    static fromYear(year: number): LunarYear
    /** 该年全部节气，键为节气名，值为对应的阳历日期 */
    getJieQiTable(): Record<string, Solar>
  }
}
