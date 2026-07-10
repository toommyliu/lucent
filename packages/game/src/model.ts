export const normalizeGameText = (value: string): string =>
  value.trim().toLowerCase();

export abstract class LiveModel<State extends object> {
  readonly #data: State;

  constructor(data: State) {
    this.#data = data;
  }

  protected get modelData(): State {
    return this.#data;
  }

  update(patch: Partial<State>): void {
    Object.assign(this.#data, patch);
  }

  replaceFrom(model: LiveModel<State>): void {
    Object.assign(this.#data, model.#data);
  }

  snapshot(): State {
    return { ...this.#data };
  }
}
