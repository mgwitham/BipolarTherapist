import { CogIcon, DocumentIcon, HomeIcon, UserIcon } from "@sanity/icons";

export function deskStructure(S: any) {
  return S.list()
    .title("Content")
    .items([
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
