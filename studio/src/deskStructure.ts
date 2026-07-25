// @sanity/icons v5 moved every icon to its own subpath export; the package
// root now exposes only `Icon` and `icons`. Same component names, new paths.
import { CogIcon } from "@sanity/icons/Cog";
import { DocumentIcon } from "@sanity/icons/Document";
import { HomeIcon } from "@sanity/icons/Home";
import { UserIcon } from "@sanity/icons/User";

export function deskStructure(S: any) {
  return S.list()
    .title("Content")
    .items([
      S.listItem()
        .title("Directory Page")
        .icon(DocumentIcon)
        .child(S.document().schemaType("directoryPage").documentId("directoryPage")),
      S.listItem()
        .title("Homepage")
        .icon(HomeIcon)
        .child(S.document().schemaType("homePage").documentId("homePage")),
      S.listItem()
        .title("Site Settings")
        .icon(CogIcon)
        .child(S.document().schemaType("siteSettings").documentId("siteSettings")),
      S.divider(),
      S.documentTypeListItem("therapist").title("Therapists").icon(UserIcon),
      S.documentTypeListItem("therapistApplication")
        .title("Therapist Applications")
        .icon(DocumentIcon),
    ]);
}
