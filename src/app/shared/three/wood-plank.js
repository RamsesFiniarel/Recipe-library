/** Paints a dark wood plank (gradient, grain, noise) on a canvas. Grain
 * amplitude is zero at both edges (sine window), so it tiles seamlessly. */
export function paintWoodPlank(size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size / 4;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;

  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, "#5e4938");
  base.addColorStop(0.5, "#4f3c2d");
  base.addColorStop(1, "#443327");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  const grainCount = 26;
  const segments = 12;
  for (let i = 0; i < grainCount; i += 1) {
    const y = (i / grainCount) * height + (Math.random() - 0.5) * (height / grainCount) * 0.6;
    const alpha = 0.05 + Math.random() * 0.12;
    const lighten = Math.random() > 0.5;
    ctx.strokeStyle = lighten ? `rgba(214, 178, 140, ${alpha})` : `rgba(20, 12, 8, ${alpha + 0.05})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.6;

    // Wave plus jitter under a sine window: back to the start height at both
    // ends.
    const waveCycles = 1 + Math.random() * 2;
    const wavePhase = Math.random() * Math.PI * 2;
    const waveAmplitude = height * (0.015 + Math.random() * 0.015);
    const jitterAmplitude = 2 + Math.random() * 2;

    ctx.beginPath();
    for (let s = 0; s <= segments; s += 1) {
      const xNorm = s / segments;
      const edgeWindow = Math.sin(xNorm * Math.PI);
      const wave = Math.sin(xNorm * waveCycles * Math.PI * 2 + wavePhase) * waveAmplitude;
      const jitter = (Math.random() - 0.5) * jitterAmplitude;
      const wobble = edgeWindow * (wave + jitter);
      const x = xNorm * width;
      if (s === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }

  // Fine noise to break up the gradient. Purely random, so it tiles as is.
  const noisePixels = Math.floor(width * height * 0.04);
  for (let i = 0; i < noisePixels; i += 1) {
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.random() * 0.06})`;
    ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
  }

  return canvas;
}
