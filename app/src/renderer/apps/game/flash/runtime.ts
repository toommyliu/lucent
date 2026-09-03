import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import * as Army from "../army/Army";
import * as Automation from "../automation/Automation";
import * as Environment from "../environment/Environment";
import * as SettingsPolicy from "../automation/SettingsPolicy";
import * as Scripting from "../scripting/ScriptRunner";
import * as ScriptDialogs from "../scripting/ScriptDialogs";
import * as Api from "./api/Api";
import * as Bridge from "./bridge/Bridge";
import * as DiagnosticSink from "./bridge/DiagnosticSink";
import * as Gateway from "./bridge/Gateway";

const diagnosticLayer =
  typeof window !== "undefined" && window.desktop.debug
    ? DiagnosticSink.debugLayer
    : DiagnosticSink.noopLayer;
const bridgeLayer = Bridge.layer.pipe(Layer.provideMerge(diagnosticLayer));
const gatewayLayer = Gateway.layer.pipe(Layer.provideMerge(bridgeLayer));
export const apiLayer = Api.layer.pipe(Layer.provideMerge(gatewayLayer));

const consumerLayer = Layer.mergeAll(
  Automation.layer,
  Army.layer,
  Environment.layer,
  ScriptDialogs.layer,
).pipe(Layer.provideMerge(apiLayer));

export const liveLayer = Layer.mergeAll(
  SettingsPolicy.layer,
  Scripting.layer,
).pipe(Layer.provideMerge(consumerLayer));

export const flashRuntime = ManagedRuntime.make(liveLayer);
