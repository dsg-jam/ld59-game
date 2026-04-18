import { games } from "./games";

function getEl<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Element ${selector} not found`);
  }
  return el as T;
}

const gamesContainer = getEl<HTMLDivElement>(".games");
gamesContainer.innerHTML = "";

games.forEach((game, index) => {
  const anchor = document.createElement("a");
  anchor.className = "game";
  anchor.href = game.path;

  const gameNum = String(index + 1).padStart(2, "0");
  const title = game.id === "DECONSTRUCT_SIKU2" ? "Deconstruct<br>Siku2" : game.title;

  anchor.innerHTML = `
    <div class="game-top">
      <span class="game-num">${gameNum}</span>
      <span class="arrow">↗</span>
    </div>
    <div class="game-body">
      <div class="title">${title}</div>
      <div class="desc">${game.path}</div>
      <span class="tag">${game.tag}</span>
    </div>
  `;

  gamesContainer.appendChild(anchor);
});

const clock = getEl<HTMLElement>("#clock");
const countEl = getEl<HTMLElement>("#game-count");

function tick(): void {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

tick();
setInterval(tick, 1000);
countEl.textContent = String(games.length).padStart(2, "0");
