import { setLanguage } from "./i18n";

// The existing suite asserts the English copy. Pin it here so those assertions stay meaningful
// while the app itself ships Chinese by default.
setLanguage("en-US");
