import React from 'react';

type LoginPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const invalidCredentials = (await searchParams)?.error === 'invalid_credentials';

  return (
    <main className="login-page">
      <form action="/api/session" method="post" className="login-card">
        <span className="login-brand">设计宝</span>
        <h1>登录设计宝</h1>
        <p>进入运营预警工作台</p>
        {invalidCredentials && (
          <p className="login-error" role="alert">
            邮箱或密码错误，请确认与 Railway 中配置的管理员账号一致。
          </p>
        )}
        <label>
          <span>邮箱</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">登录</button>
      </form>
    </main>
  );
}
