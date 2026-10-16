/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";
import { appendFile, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

import type { CalendarState } from "./shared";

const LOG_FILE = join(homedir(), "Library/Logs/discord-calendar-status.log");
const STATE_FILE = join(homedir(), "Library/Application Support/discord-calendar-status/state.json");

export async function readState(): Promise<CalendarState | null> {
    try {
        return JSON.parse(await readFile(STATE_FILE, "utf-8"));
    } catch {
        return null;
    }
}

export async function log(_: IpcMainInvokeEvent, line: string) {
    await appendFile(LOG_FILE, `${new Date().toLocaleString("sv-SE")} [plugin] ${line}\n`);
}
