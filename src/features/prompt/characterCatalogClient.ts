import { invoke } from "@tauri-apps/api/core";
import type { CatalogCharacter } from "./characterCatalog";
let catalogPromise: Promise<CatalogCharacter[]> | undefined;
export function loadCharacterCatalog() {
  return catalogPromise ??= invoke<CatalogCharacter[]>("character_catalog").catch(error => { catalogPromise = undefined; throw error; });
}
