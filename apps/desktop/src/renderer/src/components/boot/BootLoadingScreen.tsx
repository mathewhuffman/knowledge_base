import { useEffect, useRef, useState } from 'react';
import { BootAsciiScene } from './BootAsciiScene';
import {
  BOOT_FADE_MS,
  BOOT_TOTAL_MS
} from './bootLoadingModel';

interface BootLoadingScreenProps {
  bootResolved: boolean;
  onComplete: () => void;
}

function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      setReducedMotion(mediaQuery.matches);
    };

    update();
    mediaQuery.addEventListener('change', update);
    return () => {
      mediaQuery.removeEventListener('change', update);
    };
  }, []);

  return reducedMotion;
}

export function BootLoadingScreen({
  bootResolved,
  onComplete
}: BootLoadingScreenProps) {
  const reducedMotion = useReducedMotionPreference();
  const startedAtRef = useRef(performance.now());
  const completionTimerRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    let intervalId = 0;

    const tick = () => {
      const elapsed = performance.now() - startedAtRef.current;
      setElapsedMs(Math.min(BOOT_TOTAL_MS, elapsed));

      if (!isExiting && bootResolved && elapsed >= BOOT_TOTAL_MS) {
        setIsExiting(true);
        completionTimerRef.current = window.setTimeout(() => {
          onComplete();
        }, BOOT_FADE_MS);
      }
    };

    tick();
    intervalId = window.setInterval(tick, 40);

    return () => {
      window.clearInterval(intervalId);
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
    };
  }, [bootResolved, isExiting, onComplete]);
  return (
    <div className={`boot-loading-screen ${isExiting ? 'boot-loading-screen--exit' : ''}`}>
      <BootAsciiScene
        className="boot-loading-screen__scene"
        interactive={!reducedMotion}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}
