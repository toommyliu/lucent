import { mountDesktopRenderer } from "../../RendererBootstrap";
import { App } from "./App";

mountDesktopRenderer((props) => <App {...props} />);
