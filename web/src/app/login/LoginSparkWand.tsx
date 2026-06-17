"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";

type BurstParticle = {
  id: number;
  dx: string;
  dy: string;
  delay: string;
  scale: string;
  rotate: string;
};

type Burst = {
  id: number;
  particles: BurstParticle[];
  arcRotate: string;
  arcShiftX: string;
  arcShiftY: string;
  originX: string;
  originY: string;
  sweepRotate: string;
  sweepShiftY: string;
};

const PARTICLE_COUNT = 34;
const BURST_LIFETIME_MS = 1980;

function createBurst(id: number): Burst {
  const particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
    const spread = -162 + (252 / (PARTICLE_COUNT - 1)) * index + (Math.random() - 0.5) * 14;
    const angle = (spread * Math.PI) / 180;
    const distance = 74 + Math.random() * 106;

    return {
      id: index,
      dx: `${Math.cos(angle) * distance}px`,
      dy: `${Math.sin(angle) * distance}px`,
      delay: `${index * 11}ms`,
      scale: `${1.02 + Math.random() * 1.26}`,
      rotate: `${-72 + Math.random() * 168}deg`,
    };
  });

  return {
    id,
    particles,
    arcRotate: `${-24 + Math.random() * 42}deg`,
    arcShiftX: `${-14 + Math.random() * 24}px`,
    arcShiftY: `${-12 + Math.random() * 18}px`,
    originX: `${20 + Math.random() * 16}%`,
    originY: `${60 + Math.random() * 12}%`,
    sweepRotate: `${-14 + Math.random() * 10}deg`,
    sweepShiftY: `${-4 + Math.random() * 10}px`,
  };
}

export default function LoginSparkWand({ href }: { href: string }) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const nextId = useRef(0);
  const cooldownUntil = useRef(0);
  const timers = useRef<number[]>([]);

  const scheduleCleanup = useCallback((id: number) => {
    const timeout = window.setTimeout(() => {
      setBursts((current) => current.filter((burst) => burst.id !== id));
      timers.current = timers.current.filter((entry) => entry !== timeout);
    }, BURST_LIFETIME_MS);

    timers.current.push(timeout);
  }, []);

  const triggerBurst = useCallback(
    (force = false) => {
      const now = performance.now();
      if (!force && now < cooldownUntil.current) return;
      cooldownUntil.current = now + 260;

      const id = nextId.current;
      nextId.current += 1;

      setBursts((current) => [...current, createBurst(id)]);
      scheduleCleanup(id);
    },
    [scheduleCleanup]
  );

  useEffect(() => {
    const kickoff = window.setTimeout(() => triggerBurst(true), 1180);
    const interval = window.setInterval(() => triggerBurst(true), 4200);

    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(interval);
      for (const timer of timers.current) {
        window.clearTimeout(timer);
      }
    };
  }, [triggerBurst]);

  return (
    <a
      href={href}
      className="login-enter"
      onPointerEnter={() => triggerBurst()}
      onFocus={() => triggerBurst()}
      onPointerDown={() => triggerBurst(true)}
    >
      <span className="login-enter__glow" aria-hidden="true" />
      <span className="login-enter__text">Enter</span>
      <span className="login-enter__arrow" aria-hidden="true">
        <ArrowUpRight size={18} strokeWidth={2.2} />
      </span>

      {bursts.map((burst) => (
        <span
          key={burst.id}
          className="login-enter-burst"
          style={
            {
              "--wand-arc-rotate": burst.arcRotate,
              "--wand-arc-shift-x": burst.arcShiftX,
              "--wand-arc-shift-y": burst.arcShiftY,
              "--wand-origin-x": burst.originX,
              "--wand-origin-y": burst.originY,
              "--wand-sweep-rotate": burst.sweepRotate,
              "--wand-sweep-shift-y": burst.sweepShiftY,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span className="login-enter-ring" />
          <span className="login-enter-sweep" />
          <span className="login-enter-tip" />

          <svg className="login-enter-arc" viewBox="0 0 360 220" fill="none">
            <path d="M32 198C92 164 132 132 188 102C232 80 286 70 344 46" pathLength="1" />
            <path d="M82 202C148 174 198 146 246 118C288 94 324 74 352 56" pathLength="1" />
          </svg>

          {burst.particles.map((particle) => (
            <span
              key={particle.id}
              className="login-enter-particle"
              style={
                {
                  "--wand-dx": particle.dx,
                  "--wand-dy": particle.dy,
                  "--wand-delay": particle.delay,
                  "--wand-scale": particle.scale,
                  "--wand-rotate": particle.rotate,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </a>
  );
}
