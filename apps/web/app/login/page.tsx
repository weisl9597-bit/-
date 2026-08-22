import React from 'react';

export default function LoginPage() {
  return (
    <main className="login-page">
      <form action="/api/session" method="post" className="login-card">
        <span className="login-brand">设计宝</span>
        <h1>登录设计宝</h1>
        <p>进入运营预警工作台</p>
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
