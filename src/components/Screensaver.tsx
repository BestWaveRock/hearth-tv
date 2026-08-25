import { useEffect, useState } from 'react';
import { formatClock, formatDay } from '../lib/format';
import { useT } from '../lib/i18n';
import { useApp } from '../store/app';
import { useNow } from './TopBar';

/**
 * The screensaver.
 *
 * Apple's Aerial screensavers are gigabytes of drone footage. That is not
 * available to a web app that must load anywhere, so instead each scene is
 * built from layered CSS gradients and given a very slow Ken Burns drift. The
 * result is calm, weighs nothing, and never stutters — which matters more here
 * than photographic realism.
 */

interface Scene {
  name: string;
  layers: string[];
}

const SCENES: Scene[] = [
  {
    name: 'Ember',
    layers: [
      'radial-gradient(60% 45% at 30% 82%, rgba(255,140,60,0.55), transparent 70%)',
      'radial-gradient(48% 38% at 74% 88%, rgba(226,80,60,0.42), transparent 72%)',
      'linear-gradient(180deg, #0a0510 0%, #1e0c14 48%, #46150c 100%)',
    ],
  },
  {
    name: 'Dusk over water',
    layers: [
      'radial-gradient(70% 40% at 50% 34%, rgba(255,178,107,0.4), transparent 68%)',
      'radial-gradient(90% 50% at 50% 96%, rgba(70,60,140,0.5), transparent 70%)',
      'linear-gradient(180deg, #1b1030 0%, #2a1840 42%, #0b0818 100%)',
    ],
  },
  {
    name: 'Pine and snow',
    layers: [
      'radial-gradient(56% 44% at 22% 24%, rgba(160,220,215,0.28), transparent 70%)',
      'radial-gradient(70% 46% at 76% 78%, rgba(40,90,90,0.5), transparent 72%)',
      'linear-gradient(180deg, #071016 0%, #0d2026 52%, #061014 100%)',
    ],
  },
  {
    name: 'City after rain',
    layers: [
      'radial-gradient(50% 40% at 68% 26%, rgba(255,120,150,0.32), transparent 70%)',
      'radial-gradient(76% 50% at 30% 90%, rgba(90,70,180,0.42), transparent 72%)',
      'linear-gradient(180deg, #120a1c 0%, #24122c 50%, #080410 100%)',
    ],
  },
  {
    name: 'Late night',
    layers: [
      'radial-gradient(44% 34% at 50% 18%, rgba(190,190,255,0.2), transparent 72%)',
      'radial-gradient(80% 52% at 50% 100%, rgba(30,40,90,0.6), transparent 74%)',
      'linear-gradient(180deg, #05060f 0%, #0a0d1e 56%, #03040a 100%)',
    ],
  },
];

const SCENE_MS = 20_000;

const SCENE_KEYS = [
  'screensaver.scene.ember',
  'screensaver.scene.dusk',
  'screensaver.scene.pine',
  'screensaver.scene.city',
  'screensaver.scene.night',
] as const;

export function Screensaver() {
  const clock24h = useApp((s) => s.settings.clock24h);
  const reduceMotion = useApp((s) => s.settings.reduceMotion);
  const now = useNow();
  const t = useT();
  const [index, setIndex] = useState(() => Math.floor(Math.random() * SCENES.length));

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % SCENES.length);
    }, SCENE_MS);
    return () => clearInterval(timer);
  }, []);

  const scene = SCENES[index];

  return (
    <div className="saver" role="presentation">
      {/* Keyed by index so React remounts the node and the CSS animations
          restart cleanly on every scene change. */}
      <div key={index} className="saver__scene" style={{ animationDuration: `${SCENE_MS}ms` }}>
        {scene.layers.map((layer, i) => (
          <div
            className="saver__layer"
            key={i}
            style={{
              background: layer,
              // Each layer drifts at a slightly different rate, which produces
              // parallax from flat gradients.
              animation: reduceMotion
                ? undefined
                : `kenburns ${SCENE_MS * 1.5}ms linear both`,
              animationDelay: `${i * -1200}ms`,
              filter: i === 0 ? 'blur(18px)' : undefined,
            }}
          />
        ))}
      </div>

      <div className="saver__clock">
        <p className="saver__time t-num">{formatClock(now, clock24h)}</p>
        <p className="saver__date">{formatDay(now)}</p>
      </div>

      <p className="saver__hint">{t('screensaver.wakeHint')} · {t(SCENE_KEYS[index])}</p>
    </div>
  );
}
