// The image "Dela notan" hands to the phone's share sheet (BIN-1449 sketch, part 2).
// Drawn in the browser and never uploaded, so it costs nothing and Binge keeps no copy.
// It carries services and numbers only: no titles, so sharing never says what was watched.

import { formatKr } from '@/lib/formatKr';

export interface BillImageRow { name: string; text: string }

export interface BillImageContent {
  monthName: string;
  rows: readonly BillImageRow[];
  totalKr: number;
}

export interface BillImageColors { background: string; ink: string; fontFamily: string }

// What the canvas paints with when it cannot read the oklch tokens: an assignment it
// cannot parse is ignored, so the fallback set just before it stays.
const FALLBACK_BACKGROUND = 'rgb(154,91,0)';
const FALLBACK_INK = 'white';

export const BILL_IMAGE_WIDTH = 1080;
export const BILL_IMAGE_HEIGHT = 1350;

const PAD = 80;
// A long bill would run into the total.
const MAX_ROWS = 7;

/** The font strings the image draws with, so they can be loaded before drawing. */
export function billImageFonts(fontFamily: string): string[] {
  return ['700 44px', '700 76px', '600 40px', '700 40px', '700 132px', '500 34px'].map(f => `${f} ${fontFamily}`);
}

/** The rows that fit on the image, the overflow folded into "och N till". */
export function fitRows(rows: readonly BillImageRow[]): BillImageRow[] {
  if (rows.length <= MAX_ROWS) return [...rows];
  const shown = rows.slice(0, MAX_ROWS - 1);
  return [...shown, { name: `och ${rows.length - shown.length} till`, text: '' }];
}

type Ctx = Pick<CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'globalAlpha'
  | 'fillRect' | 'fillText' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'measureText'>;

export function drawBillImage(ctx: Ctx, content: BillImageContent, colors: BillImageColors): void {
  const right = BILL_IMAGE_WIDTH - PAD;
  const FONT = colors.fontFamily;
  ctx.fillStyle = FALLBACK_BACKGROUND;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, BILL_IMAGE_WIDTH, BILL_IMAGE_HEIGHT);
  ctx.fillStyle = FALLBACK_INK;
  ctx.fillStyle = colors.ink;
  ctx.strokeStyle = FALLBACK_INK;
  ctx.strokeStyle = colors.ink;
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText('binge.nu', PAD, PAD + 44);

  ctx.font = `700 76px ${FONT}`;
  ctx.fillText(`Min streaming i ${content.monthName}`, PAD, 300, right - PAD);

  let y = 420;
  for (const row of fitRows(content.rows)) {
    ctx.textAlign = 'left';
    ctx.font = `600 40px ${FONT}`;
    ctx.fillText(row.name, PAD, y, 400);
    ctx.textAlign = 'right';
    ctx.font = `700 40px ${FONT}`;
    ctx.fillText(row.text, right, y, right - PAD - 420);
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD, y + 22);
    ctx.lineTo(right, y + 22);
    ctx.stroke();
    ctx.globalAlpha = 1;
    y += 80;
  }

  const totalY = BILL_IMAGE_HEIGHT - PAD - 90;
  ctx.textAlign = 'left';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText('Totalt', PAD, totalY);
  ctx.textAlign = 'right';
  ctx.font = `700 132px ${FONT}`;
  ctx.fillText(`${formatKr(content.totalKr)} kr`, right, totalY);

  ctx.textAlign = 'left';
  ctx.globalAlpha = 0.85;
  ctx.font = `500 34px ${FONT}`;
  ctx.fillText('Räkna på din egen på binge.nu', PAD, BILL_IMAGE_HEIGHT - PAD);
  ctx.globalAlpha = 1;
}
