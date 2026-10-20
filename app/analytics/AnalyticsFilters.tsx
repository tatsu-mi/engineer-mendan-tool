'use client';

import { useState } from 'react';

type Props = {
  preset: string;
  start: string;
  end: string;
  sort: string;
  direction: string;
  excludeAdmins: boolean;
};

export default function AnalyticsFilters({ preset, start, end, sort, direction, excludeAdmins }: Props) {
  const [selectedPeriod, setSelectedPeriod] = useState(preset);
  const customPeriod = selectedPeriod === 'custom';

  return (
    <form className="analytics-filters" method="get">
      <label>集計期間<select className="select-base" name="period" value={selectedPeriod} onChange={event => setSelectedPeriod(event.target.value)}>
        <option value="month">今月</option><option value="previous">先月</option><option value="30days">直近30日</option><option value="custom">任意期間</option>
      </select></label>
      <label>開始日（任意期間）<input className="input-base" type="date" name="start" defaultValue={start} disabled={!customPeriod} /></label>
      <label>終了日（任意期間）<input className="input-base" type="date" name="end" defaultValue={end} disabled={!customPeriod} /></label>
      <input type="hidden" name="sort" value={sort} />
      <input type="hidden" name="direction" value={direction} />
      <label className="analytics-checkbox"><input type="checkbox" name="excludeAdmins" value="1" defaultChecked={excludeAdmins} />管理者を除外する</label>
      <button className="btn btn-primary" type="submit">集計する</button>
    </form>
  );
}
