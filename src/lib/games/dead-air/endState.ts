import { writable } from 'svelte/store';

export interface PlayerReveal {
  name: string;
  role: string;
}

export interface EndState {
  winner: 'researchers' | 'mimic';
  roles: PlayerReveal[];
}

export const endState = writable<EndState | null>(null);
