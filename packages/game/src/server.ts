import { LiveModel } from "./model";

export interface Server {
  readonly chat: number;
  readonly count: number;
  readonly full: boolean;
  readonly language: string;
  readonly max: number;
  readonly memberOnly: boolean;
  readonly name: string;
  readonly online: boolean;
  toJSON(): ServerSnapshot;
}

export interface ServerData {
  chat: number;
  count: number;
  language: string;
  max: number;
  memberOnly: boolean;
  name: string;
  online: boolean;
}

export type ServerSnapshot = Readonly<ServerData> & {
  readonly full: boolean;
};

export class LiveServer extends LiveModel<ServerData> implements Server {
  get chat(): number {
    return this.modelData.chat;
  }
  get count(): number {
    return this.modelData.count;
  }
  get full(): boolean {
    return this.max > 0 && this.count >= this.max;
  }
  get language(): string {
    return this.modelData.language;
  }
  get max(): number {
    return this.modelData.max;
  }
  get memberOnly(): boolean {
    return this.modelData.memberOnly;
  }
  get name(): string {
    return this.modelData.name;
  }
  get online(): boolean {
    return this.modelData.online;
  }
  toJSON(): ServerSnapshot {
    return { ...this.modelData, full: this.full };
  }
}
