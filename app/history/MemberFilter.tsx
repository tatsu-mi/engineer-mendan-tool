'use client';

type Member = {
  id: string;
  email: string;
  display_name: string | null;
};

export default function MemberFilter({ members, selectedMemberId }: { members: Member[]; selectedMemberId: string }) {
  return (
    <form className="member-filter" method="get">
      <label htmlFor="memberId">対象メンバー</label>
      <select
        className="select-base"
        id="memberId"
        name="memberId"
        defaultValue={selectedMemberId}
        onChange={event => event.currentTarget.form?.requestSubmit()}
      >
        {members.map(item => (
          <option key={item.id} value={item.id}>
            {item.display_name ? `${item.display_name}（${item.email}）` : item.email}
          </option>
        ))}
      </select>
      <button className="btn btn-secondary member-filter-submit" type="submit">切り替える</button>
    </form>
  );
}
