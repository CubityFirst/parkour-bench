import { formatTime, type Settings } from "../game/GameState";

export interface MenuHandlers {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onSettings: (settings: Settings) => void;
}

type Panel = "main" | "controls" | "pause" | "finish" | "none";

/** Title, controls, pause, and finish. Buttons blur so Space cannot re-activate them. */
export class Menu {
  private readonly settings: Settings;
  private panel: Panel = "main";
  private readonly nodes: Record<Exclude<Panel, "none">, HTMLElement>;
  private readonly bestLine: HTMLElement;
  private readonly finishTime: HTMLElement;
  private readonly finishBest: HTMLElement;
  private readonly sensLabels: HTMLElement[] = [];

  constructor(root: HTMLElement, settings: Settings, best: number | null, private readonly handlers: MenuHandlers) {
    this.settings = settings;
    this.bestLine = el("p", "best");
    this.finishTime = el("p", "finish-time");
    this.finishBest = el("p", "best");
    this.nodes = {
      main: this.buildMain(),
      controls: this.buildControls(),
      pause: this.buildPause(),
      finish: this.buildFinish(),
    };
    for (const node of Object.values(this.nodes)) root.append(node);
    this.setBest(best);
    this.show("main");
  }

  show(panel: Panel): void {
    this.panel = panel;
    for (const [name, node] of Object.entries(this.nodes)) {
      node.hidden = name !== panel;
    }
  }

  setBest(best: number | null): void {
    const text = best === null ? "Best  —" : `Best  ${formatTime(best)}`;
    this.bestLine.textContent = text;
    this.finishBest.textContent = text;
  }

  showFinish(time: number, best: number): void {
    this.finishTime.textContent = formatTime(time);
    this.setBest(best);
    this.show("finish");
  }

  private buildMain(): HTMLElement {
    const card = this.card();
    card.append(
      titleBlock("A run across the roofs"),
      button("Start run", () => this.handlers.onStart()),
      button("Controls", () => this.show("controls"), "ghost"),
      this.sensRow(),
      this.motionRow(),
      this.bestLine,
    );
    return wrap(card);
  }

  private buildControls(): HTMLElement {
    const card = this.card();
    const list = document.createElement("ul");
    list.className = "controls";
    for (const row of [
      ["WASD", "Move"],
      ["Mouse", "Look"],
      ["Shift", "Sprint"],
      ["Space", "Jump"],
      ["Ctrl / C", "Slide"],
      ["E", "Vault"],
      ["R", "Restart at checkpoint"],
      ["Esc", "Pause"],
    ]) {
      const item = document.createElement("li");
      const key = document.createElement("b");
      key.textContent = row[0];
      item.append(key, document.createTextNode(row[1]));
      list.append(item);
    }
    card.append(titleBlock("Controls"), list, button("Back", () => this.show(this.returnPanel()), "ghost"));
    return wrap(card);
  }

  private buildPause(): HTMLElement {
    const card = this.card();
    card.append(
      titleBlock("Paused"),
      button("Resume", () => this.handlers.onResume()),
      button("Restart", () => this.handlers.onRestart(), "ghost"),
      this.sensRow(),
      this.motionRow(),
      button("Main menu", () => this.handlers.onMenu(), "ghost"),
    );
    return wrap(card);
  }

  private buildFinish(): HTMLElement {
    const card = this.card();
    const heading = document.createElement("h2");
    heading.textContent = "LEVEL COMPLETE";
    card.append(
      heading,
      this.finishTime,
      this.finishBest,
      button("Restart", () => this.handlers.onRestart()),
      button("Main menu", () => this.handlers.onMenu(), "ghost"),
    );
    return wrap(card);
  }

  private returnPanel(): Panel {
    return this.panel === "controls" ? "main" : "main";
  }

  private card(): HTMLElement {
    const card = el("div", "card");
    return card;
  }

  private sensRow(): HTMLElement {
    const row = el("label", "slider");
    const name = el("span", "slider-name");
    name.textContent = "Mouse sensitivity";
    const value = el("span", "slider-value");
    value.textContent = this.settings.sensitivity.toFixed(2);
    this.sensLabels.push(value);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0.35";
    input.max = "2";
    input.step = "0.05";
    input.value = String(this.settings.sensitivity);
    input.addEventListener("input", () => {
      this.settings.sensitivity = Number(input.value);
      for (const label of this.sensLabels) label.textContent = this.settings.sensitivity.toFixed(2);
      this.syncSliders(input.value);
      this.handlers.onSettings(this.settings);
    });
    row.append(name, value, input);
    return row;
  }

  private syncSliders(value: string): void {
    for (const node of Object.values(this.nodes)) {
      const inputs = node.querySelectorAll<HTMLInputElement>("input[type=range]");
      inputs.forEach((input) => {
        if (input.value !== value) input.value = value;
      });
    }
  }

  private motionRow(): HTMLElement {
    const row = el("label", "check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.settings.reduceMotion;
    input.addEventListener("change", () => {
      this.settings.reduceMotion = input.checked;
      this.syncChecks(input.checked);
      this.handlers.onSettings(this.settings);
    });
    const text = document.createElement("span");
    text.textContent = "Reduce camera motion";
    row.append(input, text);
    return row;
  }

  private syncChecks(checked: boolean): void {
    for (const node of Object.values(this.nodes)) {
      node.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((input) => {
        input.checked = checked;
      });
    }
  }
}

function titleBlock(tag: string): HTMLElement {
  const block = el("div", "title-block");
  const h = document.createElement("h1");
  h.innerHTML = "ROOFTOP <span>FLOW</span>";
  const p = document.createElement("p");
  p.textContent = tag;
  block.append(h, p);
  return block;
}

function button(label: string, onClick: () => void, kind = "primary"): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = kind;
  node.textContent = label;
  node.addEventListener("pointerdown", () => node.blur());
  node.addEventListener("click", () => {
    node.blur();
    onClick();
  });
  return node;
}

function wrap(card: HTMLElement): HTMLElement {
  const panel = el("div", "panel");
  panel.append(card);
  return panel;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
