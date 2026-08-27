'use client';

import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return (
    <button
      className="header-signout"
      type="button"
      onClick={() => signOut({ callbackUrl: '/' })}
    >
      ログアウト
    </button>
  );
}
