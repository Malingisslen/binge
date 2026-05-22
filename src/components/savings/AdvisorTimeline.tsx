'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import ProviderDot from '@/components/ui/ProviderDot';
import { useAdvisorTimeline, TIMELINE_WEEKS, type TimelineLane, type TimelineWeek } from '@/hooks/useAdvisorTimeline';

const CELL_WIDTH = 14;
const CELL_GAP = 2;
const COL_STRIDE = CELL_WIDTH + CELL_GAP;
const CELL_HEIGHT = 20;
const LABEL_WIDTH = 100;
const FOOTER_WIDTH = 90;
const ROW_GAP = 7;
const HEADER_HEIGHT = 48;
const MONTH_LABEL_TOP = 18;
const WEEK_LABEL_TOP = 32;

const WEEK_INDICES: number[] = Array.from({ length: TIMELINE_WEEKS }, (_, i) => i);

const USER_PAUSED_BG: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(45deg, oklch(0.60 0.010 80 / 0.25) 0 2px, transparent 2px 6px)',
  backgroundColor: 'var(--rule)',
};

const EMPTY_CELL_STYLE: React.CSSProperties = {
  width: CELL_WIDTH,
  height: CELL_HEIGHT,
  borderRadius: 2,
  backgroundColor: 'var(--bg-2)',
  border: '1px solid var(--rule-2)',
};

const USER_PAUSED_CELL_STYLE: React.CSSProperties = {
  ...USER_PAUSED_BG,
  width: CELL_WIDTH,
  height: CELL_HEIGHT,
  borderRadius: 2,
};

export default function AdvisorTimeline() {
  const { weeks, subscribedLanes, unsubscribedLanes, shouldRender, hasAirings, todayWeekIndex } = useAdvisorTimeline();
  if (!shouldRender) return null;

  if (!hasAirings) {
    return (
      <div className="bg-surface border border-border-main rounded-sm mb-[14px] px-3 py-[10px]">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kommande 6 månader</h2>
        </div>
        <p className="text-xs text-text-muted">
          Inga avsnitt på 6 månader hos dina tjänster — bra läge att pausa något du inte använder.
        </p>
      </div>
    );
  }

  const totalCellsWidth = TIMELINE_WEEKS * CELL_WIDTH + (TIMELINE_WEEKS - 1) * CELL_GAP;
  const totalWidth = LABEL_WIDTH + totalCellsWidth + FOOTER_WIDTH;

  return (
    <div className="bg-surface border border-border-main rounded-sm mb-[14px] overflow-x-auto">
      <div className="px-3 py-[10px]" style={{ minWidth: totalWidth + 24 }}>
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-xxs uppercase tracking-[0.5px] font-semibold text-text-muted">Kommande 6 månader</h2>
          <span className="text-xxs text-text-muted">Varje ruta = en vecka</span>
        </div>
        <Legend />

        <div className="relative" style={{ width: totalWidth }}>
          <MonthHeader weeks={weeks} />
          <TodayMarker todayWeekIndex={todayWeekIndex} />

          <div className="flex flex-col" style={{ gap: ROW_GAP }}>
            {subscribedLanes.map(lane => (
              <Lane key={`sub-${lane.providerId}`} lane={lane} weeks={weeks} />
            ))}
          </div>

          {unsubscribedLanes.length > 0 && (
            <>
              <div className="text-[9px] text-text-muted uppercase tracking-[0.5px] pt-3 pb-[3px] border-t border-dashed border-border-light mt-3">
                Tjänster du inte har
              </div>
              <div className="flex flex-col" style={{ gap: ROW_GAP }}>
                {unsubscribedLanes.map(lane => (
                  <Lane key={`un-${lane.providerId}`} lane={lane} weeks={weeks} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 flex-wrap text-xxs text-text-muted mb-2">
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-[10px] h-[10px] rounded-[1px]" style={{ background: 'var(--acc-deep)', opacity: 0.65 }} />
        Vecka med avsnitt
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-[10px] h-[10px] rounded-[1px] border border-border-main bg-bg-2" />
        Tom vecka
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-[10px] h-[10px] rounded-[1px]" style={USER_PAUSED_BG} />
        Du har pausat
      </span>
    </div>
  );
}

function MonthHeader({ weeks }: { weeks: TimelineWeek[] }) {
  return (
    <div className="relative" style={{ height: HEADER_HEIGHT, marginLeft: LABEL_WIDTH, width: TIMELINE_WEEKS * COL_STRIDE - CELL_GAP }}>
      {weeks.map((w, i) => (
        <Fragment key={w.startIso}>
          {w.monthLabel && (
            <>
              <div
                className="absolute flex items-start"
                style={{ left: i * COL_STRIDE, top: MONTH_LABEL_TOP }}
              >
                <span className="text-[9px] text-text-secondary uppercase tracking-[0.5px] font-semibold whitespace-nowrap">
                  {w.monthLabel}
                </span>
              </div>
              <div
                className="absolute bottom-0 w-[1px] h-[5px] bg-border-main"
                style={{ left: i * COL_STRIDE }}
              />
            </>
          )}
          {i % 4 === 0 && (
            <div
              className="absolute flex items-center"
              style={{ left: i * COL_STRIDE + CELL_WIDTH / 2, top: WEEK_LABEL_TOP, transform: 'translateX(-50%)' }}
              title={w.rangeLabel}
            >
              <span className="text-[8px] text-text-muted whitespace-nowrap">
                v.{w.weekOfYear}
              </span>
            </div>
          )}
        </Fragment>
      ))}
      <div className="absolute left-0 right-0 bottom-0 h-[1px] bg-border-light" />
    </div>
  );
}

function TodayMarker({ todayWeekIndex }: { todayWeekIndex: number }) {
  const lineLeft = LABEL_WIDTH + todayWeekIndex * COL_STRIDE + CELL_WIDTH / 2;
  return (
    <>
      <div
        aria-hidden
        className="absolute bg-accent pointer-events-none z-20"
        style={{ left: lineLeft - 1, width: 2, top: HEADER_HEIGHT - 2, bottom: 0 }}
      />
      <div
        aria-hidden
        className="absolute px-[6px] py-[2px] bg-accent text-white rounded-[2px] text-[9px] font-bold uppercase tracking-[0.5px] pointer-events-none z-30 whitespace-nowrap"
        style={{ left: lineLeft, top: 0, transform: 'translateX(-50%)' }}
      >
        Idag ↓
      </div>
    </>
  );
}

function Lane({ lane, weeks }: { lane: TimelineLane; weeks: TimelineWeek[] }) {
  const isUnsubscribed = lane.kind === 'unsubscribed';
  const isUserPaused = lane.kind === 'user-paused';
  const cellColor = isUnsubscribed ? 'var(--ink-3)' : lane.color;
  const cellOpacity = isUnsubscribed ? 0.4 : (isUserPaused ? 0.3 : 0.7);
  const emptyStyle = isUserPaused ? USER_PAUSED_CELL_STYLE : EMPTY_CELL_STYLE;

  const labelClasses = isUnsubscribed
    ? 'text-text-muted'
    : isUserPaused
      ? 'text-text-muted font-semibold'
      : 'text-text-primary font-semibold';

  return (
    <div className="flex items-center" style={{ height: CELL_HEIGHT }}>
      <div
        className={`flex items-center gap-[5px] text-xxs truncate shrink-0 sticky left-0 z-10 bg-surface pr-1 ${labelClasses}`}
        style={{ width: LABEL_WIDTH, height: CELL_HEIGHT }}
      >
        <ProviderDot color={lane.color} size={6} />
        <span className="truncate">{lane.shortName}</span>
      </div>
      <div className="flex shrink-0" style={{ gap: CELL_GAP }}>
        {WEEK_INDICES.map(i => {
          const cell = lane.cellByIndex.get(i);
          const hasContent = !!cell && cell.entries.length > 0;
          if (hasContent) {
            const entries = cell!.entries;
            const tooltipLines = entries.map(e => `${e.title}${e.episodeCode ? ` ${e.episodeCode}` : ''}`);
            const title = `${weeks[i].rangeLabel}\n\n${tooltipLines.join('\n')}`;
            const ariaLabel = `${lane.shortName} ${weeks[i].rangeLabel}: ${entries.map(e => e.title).join(', ')}`;
            return (
              <Link
                key={i}
                href="/calendar"
                title={title}
                aria-label={ariaLabel}
                className="block rounded-sm"
                style={{ width: CELL_WIDTH, height: CELL_HEIGHT, backgroundColor: cellColor, opacity: cellOpacity }}
              />
            );
          }
          return <div key={i} style={emptyStyle} title={weeks[i].rangeLabel} />;
        })}
      </div>
      <div
        className="flex items-center text-xxs justify-end pl-3 whitespace-nowrap shrink-0"
        style={{ width: FOOTER_WIDTH, height: CELL_HEIGHT }}
      >
        <LaneFooter lane={lane} />
      </div>
    </div>
  );
}

function LaneFooter({ lane }: { lane: TimelineLane }) {
  switch (lane.kind) {
    case 'unsubscribed': {
      const serier = lane.followingShowCount === 1 ? 'serie' : 'serier';
      return <span className="text-text-muted">{lane.followingShowCount} {serier}</span>;
    }
    case 'user-paused':
      return <span className="text-text-muted">Pausad</span>;
    case 'pause':
      return <span className="text-season-done">Kan pausas</span>;
    case 'free':
      return <span className="text-text-muted">Gratis</span>;
    default:
      return lane.monthlyCost != null && lane.monthlyCost > 0
        ? <span className="text-text-muted">{lane.monthlyCost} kr/mån</span>
        : null;
  }
}
