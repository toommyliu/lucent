import { Layer, ManagedRuntime } from "effect";

import * as Army from "../army/Army";
import * as Automation from "../automation/Automation";
import * as SettingsPolicy from "../automation/SettingsPolicy";
import * as Scripting from "../scripting/ScriptRunner";
import * as Api from "./api/Api";
import * as Bridge from "./bridge/Bridge";
import * as Gateway from "./bridge/Gateway";

const gatewayLayer = Gateway.layer.pipe(Layer.provideMerge(Bridge.layer));
export const apiLayer = Api.layer.pipe(Layer.provideMerge(gatewayLayer));

const consumerLayer = Layer.mergeAll(Automation.layer, Army.layer).pipe(
  Layer.provideMerge(apiLayer),
);

export const liveLayer = Layer.mergeAll(
  SettingsPolicy.layer,
  Scripting.layer,
).pipe(Layer.provideMerge(consumerLayer));

export const flashRuntime = ManagedRuntime.make(liveLayer);
