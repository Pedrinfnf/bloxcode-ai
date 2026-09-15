import './globals.css';

export const metadata = {
  title: 'BloxCode Work',
  description: 'Kimi K3 agentic coding workspace powered by vLLM and Vercel Sandbox.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
