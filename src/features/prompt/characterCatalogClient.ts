import { invoke } from "@tauri-apps/api/core";
import { apiJson, isWebServerRuntime } from "../../adapters/webApi";
import type { CatalogCharacter } from "./characterCatalog";
let catalogPromise: Promise<CatalogCharacter[]> | undefined;
export function loadCharacterCatalog() {
  return catalogPromise ??= (
    isWebServerRuntime()
      ? apiJson<CatalogCharacter[]>("/api/character-catalog")
      : invoke<CatalogCharacter[]>("character_catalog")
  ).catch(error => { catalogPromise = undefined; throw error; });
}
