import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* 将 viewport meta 标签静态地放在这里，是解决移动端随机缩放问题的最佳实践。
          这可以确保浏览器在解析HTML的第一时间就能正确设置视口，避免因JS动态添加而导致的时序问题。
        */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <meta name='description' content='享受音趴！' />
        <link rel='icon' href='/favicon.ico' />
        <meta name='referrer' content='never' />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
