import "dotenv/config";
import { startSuperPeer } from "./server";
import { superPeerConfig } from "./config";

startSuperPeer(superPeerConfig);
