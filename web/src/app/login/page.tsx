import type { CSSProperties } from "react";
import Image from "next/image";
import { BRAND_NAME, BRAND_SLOGAN } from "@/lib/brand";
import LoginSparkWand from "./LoginSparkWand";
import "./login-anim.css";

export const dynamic = "force-dynamic";

function seeded(index: number): number {
  const value = Math.sin(index * 97.131) * 43758.5453;
  return value - Math.floor(value);
}

const LETTERS = [
  { char: "S", variant: "twirl", delay: "0.02s", duration: "1.14s", fromX: "-118px", fromY: "-162px", rotate: "-28deg", scaleX: "0.3", scaleY: "0.14", idleX: "-2px", idleY: "-8px", idleRotate: "-1.8deg" },
  { char: "p", variant: "swoop", delay: "0.21s", duration: "1.04s", fromX: "84px", fromY: "-112px", rotate: "18deg", scaleX: "0.54", scaleY: "0.18", idleX: "1px", idleY: "-6px", idleRotate: "1.2deg" },
  { char: "a", variant: "pop", delay: "0.39s", duration: "0.96s", fromX: "-64px", fromY: "-138px", rotate: "-16deg", scaleX: "0.38", scaleY: "0.18", idleX: "-1px", idleY: "-5px", idleRotate: "-0.8deg" },
  { char: "r", variant: "swoop", delay: "0.57s", duration: "1.02s", fromX: "52px", fromY: "-104px", rotate: "14deg", scaleX: "0.5", scaleY: "0.2", idleX: "1px", idleY: "-7px", idleRotate: "0.9deg" },
  { char: "k", variant: "twirl", delay: "0.7s", duration: "1.1s", fromX: "-48px", fromY: "-152px", rotate: "-20deg", scaleX: "0.32", scaleY: "0.14", idleX: "-1px", idleY: "-8px", idleRotate: "-1.4deg" },
  { char: "l", variant: "pop", delay: "0.93s", duration: "0.92s", fromX: "24px", fromY: "-128px", rotate: "12deg", scaleX: "0.4", scaleY: "0.16", idleX: "0px", idleY: "-6px", idleRotate: "0.7deg" },
  { char: "o", variant: "swoop", delay: "1.08s", duration: "1.03s", fromX: "-70px", fromY: "-132px", rotate: "-14deg", scaleX: "0.38", scaleY: "0.18", idleX: "-1px", idleY: "-7px", idleRotate: "-0.9deg" },
  { char: "o", variant: "twirl", delay: "1.24s", duration: "1.08s", fromX: "58px", fromY: "-118px", rotate: "16deg", scaleX: "0.46", scaleY: "0.2", idleX: "1px", idleY: "-6px", idleRotate: "1deg" },
  { char: "m", variant: "pop", delay: "1.47s", duration: "1s", fromX: "-56px", fromY: "-164px", rotate: "-18deg", scaleX: "0.32", scaleY: "0.12", idleX: "-2px", idleY: "-8px", idleRotate: "-1.1deg" },
];

const STARS = Array.from({ length: 34 }, (_, index) => ({
  x: `${4 + seeded(index + 1) * 92}%`,
  y: `${6 + seeded(index + 41) * 86}%`,
  size: `${5 + seeded(index + 81) * 7}px`,
  delay: `${(seeded(index + 121) * 2.2).toFixed(2)}s`,
  duration: `${(4.1 + seeded(index + 161) * 2.3).toFixed(2)}s`,
}));

const DUST = Array.from({ length: 40 }, (_, index) => ({
  x: `${3 + seeded(index + 201) * 94}%`,
  y: `${8 + seeded(index + 241) * 84}%`,
  size: `${2.5 + seeded(index + 281) * 3.2}px`,
  delay: `${(seeded(index + 321) * 2).toFixed(2)}s`,
  duration: `${(9.8 + seeded(index + 361) * 3.8).toFixed(2)}s`,
  dx: `${Math.round((seeded(index + 401) - 0.5) * 54)}px`,
  dy: `${Math.round((seeded(index + 441) - 0.5) * 54)}px`,
}));

const COMETS = [
  { x: "10%", y: "16%", width: "180px", rotate: "18deg", delay: "0.8s", duration: "8.2s" },
  { x: "58%", y: "8%", width: "164px", rotate: "22deg", delay: "3.2s", duration: "9.1s" },
  { x: "18%", y: "72%", width: "144px", rotate: "-11deg", delay: "4.8s", duration: "9.8s" },
  { x: "78%", y: "58%", width: "132px", rotate: "12deg", delay: "6.1s", duration: "8.6s" },
  { x: "34%", y: "28%", width: "120px", rotate: "16deg", delay: "7.4s", duration: "10.2s" },
];

const LOGIN_ERROR_TEXT: Record<string, string> = {
  feishu_config: "系统登录配置需要更新，请联系管理员。",
  account_disabled: "当前账号已停用，请联系管理员。",
  invalid_state: "登录状态已过期，请重新进入。",
  feishu_denied: "授权未完成，请重新进入。",
  no_code: "授权结果无效，请重新进入。",
  auth_failed: "登录失败，请稍后重试。",
};

type LoginPageProps = {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const feishuAuthUrl = "/api/auth/feishu/start";
  const params = await searchParams;
  const rawError = params?.error;
  const errorCode = Array.isArray(rawError) ? rawError[0] : rawError;
  const errorText = errorCode ? LOGIN_ERROR_TEXT[errorCode] || LOGIN_ERROR_TEXT.auth_failed : "";

  return (
    <div className="login-page">
      <div className="login-page__aurora" aria-hidden="true" />
      <div className="login-page__grain" aria-hidden="true" />
      <div className="login-page__grid" aria-hidden="true" />

      {STARS.map((star) => (
        <span
          key={`${star.x}-${star.y}`}
          className="login-star"
          style={
            {
              "--star-x": star.x,
              "--star-y": star.y,
              "--star-size": star.size,
              "--star-delay": star.delay,
              "--star-duration": star.duration,
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ))}

      {DUST.map((dust) => (
        <span
          key={`${dust.x}-${dust.y}`}
          className="login-dust"
          style={
            {
              "--dust-x": dust.x,
              "--dust-y": dust.y,
              "--dust-size": dust.size,
              "--dust-delay": dust.delay,
              "--dust-duration": dust.duration,
              "--dust-dx": dust.dx,
              "--dust-dy": dust.dy,
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ))}

      {COMETS.map((comet, index) => (
        <span
          key={`${comet.x}-${comet.y}-${index}`}
          className="login-comet"
          style={
            {
              "--comet-x": comet.x,
              "--comet-y": comet.y,
              "--comet-width": comet.width,
              "--comet-rotate": comet.rotate,
              "--comet-delay": comet.delay,
              "--comet-duration": comet.duration,
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ))}

      <main className="login-hero">
        <div className="login-logoWrap">
          <span className="login-logoHalo" aria-hidden="true" />
          <Image
            src="/logo.png"
            alt={BRAND_NAME}
            width={122}
            height={122}
            priority
            className="login-logo"
          />
        </div>

        <h1 className="login-wordmark" aria-label={BRAND_NAME}>
          {LETTERS.map((letter, index) => (
            <span
              key={`${letter.char}-${index}`}
              className={`login-letter login-letter--${letter.variant}`}
              style={
                {
                  "--letter-delay": letter.delay,
                  "--letter-duration": letter.duration,
                  "--letter-rotate": letter.rotate,
                  "--letter-from-x": letter.fromX,
                  "--letter-from-y": letter.fromY,
                  "--letter-scale-x": letter.scaleX,
                  "--letter-scale-y": letter.scaleY,
                  "--letter-idle-x": letter.idleX,
                  "--letter-idle-y": letter.idleY,
                  "--letter-idle-rotate": letter.idleRotate,
                } as CSSProperties
              }
              data-letter={letter.char}
              aria-hidden="true"
            >
              {letter.char}
            </span>
          ))}
        </h1>

        <p className="login-slogan">{BRAND_SLOGAN}</p>

        <div className="login-actions">
          <LoginSparkWand href={feishuAuthUrl} />
        </div>

        {errorText && <p className="login-error">{errorText}</p>}

        <div className="login-trails" aria-hidden="true">
          <svg viewBox="0 0 760 220" fill="none">
            <path d="M28 164C118 120 194 74 296 58C396 42 474 76 554 122C618 160 668 172 732 158" pathLength="1" />
            <path d="M148 192C242 126 314 96 396 94C480 92 556 126 636 188" pathLength="1" />
          </svg>
        </div>
      </main>
    </div>
  );
}
