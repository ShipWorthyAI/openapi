import { Schema } from "effect";
import * as V10 from "./schemas/1.0.ts";
import * as V11 from "./schemas/1.1.ts";

export const OverlayInfo = Schema.Union([V10.OverlayInfo, V11.OverlayInfo]);
export type OverlayInfo = typeof OverlayInfo.Type;

export const OverlayAction = Schema.Union([V10.OverlayAction, V11.OverlayAction]);
export type OverlayAction = typeof OverlayAction.Type;

export const Overlay = Schema.Union([V10.Overlay, V11.Overlay]);
export type Overlay = typeof Overlay.Type;
