import type { Metadata } from 'next';
import { LoginFlow } from './login-flow';

export const metadata: Metadata = { title: 'Masuk' };

export default function LoginPage() {
  return (
    <>
      <h1>Masuk ke NALARA OS</h1>
      <LoginFlow />
    </>
  );
}
