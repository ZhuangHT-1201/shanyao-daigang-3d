import * as THREE from "three";

const textureCache = new Map();

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function grain(ctx, width, height, amount, random, alpha = 0.12) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = (random() - 0.5) * amount;
    data[i] = Math.max(0, Math.min(255, data[i] + value));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + value));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + value));
    data[i + 3] = Math.round(data[i + 3] * (1 - alpha));
  }
  ctx.putImageData(image, 0, 0);
}

function drawAshlar(ctx, width, height, random, colors) {
  ctx.fillStyle = colors.mortar;
  ctx.fillRect(0, 0, width, height);
  const rows = 12;
  const rowHeight = height / rows;
  for (let row = 0; row < rows; row += 1) {
    let x = row % 2 === 0 ? -24 : -5;
    while (x < width) {
      const blockWidth = 46 + random() * 68;
      const inset = 2 + random() * 2;
      ctx.fillStyle = colors.stones[Math.floor(random() * colors.stones.length)];
      ctx.beginPath();
      ctx.roundRect(
        x + inset,
        row * rowHeight + inset,
        blockWidth - inset * 2,
        rowHeight - inset * 2,
        2 + random() * 4,
      );
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.lineWidth = 1;
      ctx.stroke();
      x += blockWidth;
    }
  }
}

function texturedCanvas(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  return canvas;
}

export function createProceduralTextures(renderer) {
  if (textureCache.has("set")) {
    return textureCache.get("set");
  }

  const random = mulberry32(491207);

  const graniteCanvas = texturedCanvas(512, (ctx, size) => {
    drawAshlar(ctx, size, size, random, {
      mortar: "#b8b5aa",
      stones: ["#d1cdc0", "#c6c3b7", "#d8d3c4", "#bdbbae", "#cec8b8"],
    });
    grain(ctx, size, size, 34, random, 0.04);
    for (let i = 0; i < 130; i += 1) {
      ctx.fillStyle = random() > 0.55 ? "rgba(83,84,77,.24)" : "rgba(255,255,250,.2)";
      ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
    }
  });

  const brickCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#c9bca8";
    ctx.fillRect(0, 0, size, size);
    const rowHeight = 24;
    const brickWidth = 62;
    for (let row = 0; row < Math.ceil(size / rowHeight); row += 1) {
      const offset = row % 2 === 0 ? -brickWidth / 2 : 0;
      for (let x = offset; x < size; x += brickWidth) {
        const warm = 0.78 + random() * 0.22;
        ctx.fillStyle = `rgb(${Math.round(153 * warm)}, ${Math.round(66 * warm)}, ${Math.round(49 * warm)})`;
        ctx.fillRect(x + 2, row * rowHeight + 2, brickWidth - 4, rowHeight - 4);
        ctx.fillStyle = "rgba(255,205,164,.07)";
        ctx.fillRect(x + 4, row * rowHeight + 3, brickWidth - 8, 2);
      }
    }
    grain(ctx, size, size, 24, random, 0.03);
  });

  const roofCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#30393a";
    ctx.fillRect(0, 0, size, size);
    const tileWidth = 22;
    for (let x = 0; x < size; x += tileWidth) {
      const grad = ctx.createLinearGradient(x, 0, x + tileWidth, 0);
      grad.addColorStop(0, "#1b2426");
      grad.addColorStop(0.3, "#4e5856");
      grad.addColorStop(0.55, "#6d7169");
      grad.addColorStop(0.76, "#333d3c");
      grad.addColorStop(1, "#161f20");
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, tileWidth - 1, size);
      ctx.fillStyle = "rgba(255,235,205,.08)";
      ctx.fillRect(x + 7, 0, 2, size);
    }
    for (let y = 0; y < size; y += 34) {
      ctx.fillStyle = "rgba(8,13,13,.3)";
      ctx.fillRect(0, y, size, 2);
    }
    grain(ctx, size, size, 24, random, 0.02);
  });

  const templeRoofCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#492d25";
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 25) {
      const grad = ctx.createLinearGradient(x, 0, x + 25, 0);
      grad.addColorStop(0, "#351c18");
      grad.addColorStop(0.3, "#8e5034");
      grad.addColorStop(0.58, "#bc7450");
      grad.addColorStop(0.75, "#5f3327");
      grad.addColorStop(1, "#2c1917");
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, 23, size);
    }
    for (let y = 0; y < size; y += 29) {
      ctx.fillStyle = "rgba(26,13,10,.28)";
      ctx.fillRect(0, y, size, 2);
    }
    grain(ctx, size, size, 26, random, 0.025);
  });

  const plasterCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#d4c6ad";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 400; i += 1) {
      const shade = random() > 0.5 ? "rgba(105,91,68,.05)" : "rgba(255,255,245,.045)";
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 1 + random() * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 28; i += 1) {
      const y = random() * size;
      const grad = ctx.createLinearGradient(0, y, 0, y + 60);
      grad.addColorStop(0, "rgba(89,106,88,.08)");
      grad.addColorStop(1, "rgba(89,106,88,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(random() * size, y, 1 + random() * 4, 40 + random() * 80);
    }
    grain(ctx, size, size, 17, random, 0.03);
  });

  const asphaltCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#414441";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, size, size, 48, random, 0.01);
    for (let i = 0; i < 1200; i += 1) {
      ctx.fillStyle = random() > 0.5 ? "rgba(198,194,181,.16)" : "rgba(16,19,18,.24)";
      const radius = random() * 1.4;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(24,25,23,.3)";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i += 1) {
      ctx.beginPath();
      let x = random() * size;
      let y = random() * size;
      ctx.moveTo(x, y);
      for (let n = 0; n < 5; n += 1) {
        x += (random() - 0.5) * 80;
        y += 20 + random() * 35;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });

  const stoneCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#9d9b8e";
    ctx.fillRect(0, 0, size, size);
    const columns = 11;
    const rows = 11;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const w = size / columns;
        const h = size / rows;
        const jitter = random() * 5;
        ctx.fillStyle = ["#b7b4a6", "#aaa99c", "#c2bfb0", "#98988d"][Math.floor(random() * 4)];
        ctx.beginPath();
        ctx.roundRect(col * w + 2 + jitter * 0.2, row * h + 2, w - 5, h - 5, 3 + jitter);
        ctx.fill();
      }
    }
    grain(ctx, size, size, 34, random, 0.03);
  });

  const oldStreetCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#77776d";
    ctx.fillRect(0, 0, size, size);
    const slabWidth = 86;
    const slabHeight = 42;
    for (let row = 0; row < Math.ceil(size / slabHeight); row += 1) {
      const offset = row % 2 === 0 ? -slabWidth / 2 : 0;
      for (let x = offset; x < size; x += slabWidth) {
        const shade = 104 + Math.round(random() * 24);
        ctx.fillStyle = `rgb(${shade},${shade + 1},${shade - 4})`;
        ctx.fillRect(x + 2, row * slabHeight + 2, slabWidth - 4, slabHeight - 4);
        ctx.fillStyle = "rgba(245,239,218,.055)";
        ctx.fillRect(x + 5, row * slabHeight + 3, slabWidth - 10, 2);
      }
    }
    for (let i = 0; i < 34; i += 1) {
      const x = random() * size;
      const y = random() * size;
      ctx.strokeStyle = `rgba(42,45,40,${0.07 + random() * 0.1})`;
      ctx.lineWidth = 0.8 + random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 38, y + 10 + random() * 45);
      ctx.stroke();
    }
    grain(ctx, size, size, 32, random, 0.02);
  });

  const groundCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#667250";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 800; i += 1) {
      const green = 86 + Math.round(random() * 48);
      const red = 67 + Math.round(random() * 31);
      const blue = 45 + Math.round(random() * 30);
      ctx.fillStyle = `rgba(${red},${green},${blue},${0.08 + random() * 0.16})`;
      ctx.beginPath();
      ctx.arc(random() * size, random() * size, 2 + random() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 1800; i += 1) {
      ctx.strokeStyle = `rgba(218,212,156,${0.04 + random() * 0.09})`;
      ctx.beginPath();
      const x = random() * size;
      const y = random() * size;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 4, y - 2 - random() * 4);
      ctx.stroke();
    }
    grain(ctx, size, size, 17, random, 0.02);
  });

  const fieldCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#6d7248";
    ctx.fillRect(0, 0, size, size);
    for (let y = 6; y < size; y += 22) {
      ctx.strokeStyle = "rgba(44,50,29,.35)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + 2);
      ctx.stroke();
      for (let x = 4; x < size; x += 9) {
        ctx.strokeStyle = `rgba(${80 + random() * 30},${115 + random() * 42},${55 + random() * 20},.42)`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x + 1, y - 6 - random() * 5);
        ctx.stroke();
      }
    }
  });

  const awningCanvas = texturedCanvas(512, (ctx, size) => {
    ctx.fillStyle = "#d8c8a7";
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 48) {
      ctx.fillStyle = "#a84938";
      ctx.fillRect(x, 0, 24, size);
    }
    grain(ctx, size, size, 16, random, 0.02);
  });

  const windowCanvas = texturedCanvas(256, (ctx, size) => {
    ctx.fillStyle = "#bbb6aa";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#17262b";
    ctx.fillRect(20, 18, size - 40, size - 36);
    const reflection = ctx.createLinearGradient(24, 20, size - 20, size - 20);
    reflection.addColorStop(0, "rgba(155,181,185,.3)");
    reflection.addColorStop(0.45, "rgba(67,91,98,.08)");
    reflection.addColorStop(1, "rgba(10,18,20,.32)");
    ctx.fillStyle = reflection;
    ctx.fillRect(20, 18, size - 40, size - 36);
    ctx.strokeStyle = "#665347";
    ctx.lineWidth = 6;
    for (let x = 42; x < size; x += 38) {
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, size - 18);
      ctx.stroke();
    }
    for (let y = 40; y < size; y += 36) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(size - 20, y);
      ctx.stroke();
    }
  });

  const set = {
    granite: canvasTexture(graniteCanvas, renderer),
    brick: canvasTexture(brickCanvas, renderer),
    roof: canvasTexture(roofCanvas, renderer),
    templeRoof: canvasTexture(templeRoofCanvas, renderer),
    plaster: canvasTexture(plasterCanvas, renderer),
    asphalt: canvasTexture(asphaltCanvas, renderer),
    stone: canvasTexture(stoneCanvas, renderer),
    oldStreet: canvasTexture(oldStreetCanvas, renderer),
    ground: canvasTexture(groundCanvas, renderer),
    field: canvasTexture(fieldCanvas, renderer),
    awning: canvasTexture(awningCanvas, renderer),
    window: canvasTexture(windowCanvas, renderer),
  };

  for (const texture of Object.values(set)) {
    texture.repeat.set(2, 2);
  }

  textureCache.set("set", set);
  return set;
}

export function makeLabelTexture(text, options = {}) {
  const key = `label:${text}:${JSON.stringify(options)}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const width = options.width ?? 720;
  const height = options.height ?? 220;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = options.background ?? "#2a211b";
  ctx.fillRect(0, 0, width, height);
  if (options.border !== false) {
    ctx.strokeStyle = options.borderColor ?? "#c5a365";
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.strokeStyle = "rgba(255,235,196,.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(21, 21, width - 42, height - 42);
  }

  if (options.subtext) {
    ctx.fillStyle = options.subcolor ?? "rgba(244,230,201,.7)";
    ctx.font = `${options.subsize ?? 30}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(options.subtext, width / 2, 55);
  }

  ctx.fillStyle = options.color ?? "#f1dfb9";
  const fontSize = options.fontSize ?? 105;
  ctx.font = `${options.weight ?? 500} ${fontSize}px "STSong", "SimSun", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, options.subtext ? height * 0.61 : height * 0.52);

  if (options.distress) {
    ctx.globalCompositeOperation = "destination-out";
    const random = mulberry32(text.length * 991);
    for (let i = 0; i < 90; i += 1) {
      ctx.globalAlpha = 0.1 + random() * 0.22;
      ctx.beginPath();
      ctx.arc(random() * width, random() * height, 1 + random() * 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

export function makeSpriteTexture(kind = "glow") {
  const key = `sprite:${kind}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);

  if (kind === "glow") {
    grad.addColorStop(0, "rgba(255,245,208,1)");
    grad.addColorStop(0.12, "rgba(255,215,137,.85)");
    grad.addColorStop(0.45, "rgba(255,171,77,.22)");
    grad.addColorStop(1, "rgba(255,156,60,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  } else if (kind === "rain") {
    grad.addColorStop(0, "rgba(197,222,231,.7)");
    grad.addColorStop(1, "rgba(197,222,231,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(64, 64, 7, 64, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    grad.addColorStop(0, "rgba(150,214,194,1)");
    grad.addColorStop(0.25, "rgba(125,189,172,.7)");
    grad.addColorStop(1, "rgba(125,189,172,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

export function makeWaterNormalTexture() {
  if (textureCache.has("water-normal")) return textureCache.get("water-normal");
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  const random = mulberry32(2204);
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      heights[y * size + x] =
        Math.sin(x * 0.08) * 0.32 +
        Math.cos(y * 0.12) * 0.23 +
        Math.sin((x + y) * 0.05) * 0.18 +
        (random() - 0.5) * 0.1;
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heights[y * size + Math.max(0, x - 1)];
      const right = heights[y * size + Math.min(size - 1, x + 1)];
      const up = heights[Math.max(0, y - 1) * size + x];
      const down = heights[Math.min(size - 1, y + 1) * size + x];
      const nx = (left - right) * 2.2;
      const ny = (up - down) * 2.2;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const offset = (y * size + x) * 4;
      image.data[offset] = (nx / length * 0.5 + 0.5) * 255;
      image.data[offset + 1] = (ny / length * 0.5 + 0.5) * 255;
      image.data[offset + 2] = (nz / length * 0.5 + 0.5) * 255;
      image.data[offset + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 18);
  texture.needsUpdate = true;
  textureCache.set("water-normal", texture);
  return texture;
}
