import { BootAsciiScene } from './BootAsciiScene';
import {
  BOOT_ASCII_PREVIEW,
  BOOT_PHASES,
  BOOT_TOTAL_MS,
  formatPhaseWindow,
  getPhaseMidpoint
} from './bootLoadingModel';

function BootStoryboardCard({ phaseIndex }: { phaseIndex: number }) {
  const phase = BOOT_PHASES[phaseIndex]!;
  const progressMs = getPhaseMidpoint(phase);

  return (
    <article className="boot-storyboard-card">
      <div className="boot-storyboard-card__scene">
        <BootAsciiScene
          compact
          interactive={false}
          progressOverrideMs={progressMs}
          reducedMotion
        />
      </div>
      <div className="boot-storyboard-card__body">
        <div className="boot-storyboard-card__title-row">
          <h2 className="boot-storyboard-card__title">KnowledgeBase</h2>
          <span className="boot-storyboard-card__cursor" aria-hidden="true" />
        </div>
        <p className="boot-storyboard-card__description">{phase.description}</p>
        <ol className="boot-storyboard-card__steps">
          {BOOT_PHASES.map((step, index) => (
            <li
              key={step.key}
              className={[
                'boot-storyboard-card__step',
                index === phaseIndex ? 'boot-storyboard-card__step--active' : ''
              ].join(' ').trim()}
            >
              <span>{step.label}</span>
              <span>{formatPhaseWindow(step)}</span>
            </li>
          ))}
        </ol>
      </div>
      <footer className="boot-storyboard-card__strip">
        <div className="boot-storyboard-card__meta">
          <span className="boot-storyboard-card__meta-label">ASCII</span>
          <code>{BOOT_ASCII_PREVIEW}</code>
        </div>
        <div className="boot-storyboard-card__meta">
          <span className="boot-storyboard-card__meta-label">Typography</span>
          <span>Roboto</span>
        </div>
        <div className="boot-storyboard-card__meta">
          <span className="boot-storyboard-card__meta-label">Log</span>
          <span>{phase.logLine}</span>
        </div>
      </footer>
    </article>
  );
}

export function BootLoadingStoryboard() {
  return (
    <div className="boot-storyboard">
      <header className="boot-storyboard__header">
        <div>
          <p className="boot-storyboard__eyebrow">KnowledgeBase ASCII Boot Experience</p>
          <h1 className="boot-storyboard__title">6-Panel Boot Storyboard</h1>
        </div>
        <p className="boot-storyboard__copy">
          Editorial, trust-first, and system-level. The production loader runs for {BOOT_TOTAL_MS}ms and uses
          the same Pretext-driven ASCII renderer shown here.
        </p>
      </header>

      <div className="boot-storyboard__grid">
        {BOOT_PHASES.map((_, index) => (
          <BootStoryboardCard key={BOOT_PHASES[index]!.key} phaseIndex={index} />
        ))}
      </div>
    </div>
  );
}
