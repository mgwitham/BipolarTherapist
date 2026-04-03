import { defineField, defineType } from "sanity";

function optionArrayField(name: string, title: string) {
  return defineField({
    name,
    title,
    type: "array",
    of: [
      defineField({
        name: `${name}Item`,
        title: "Option",
        type: "string",
      }),
    ],
    options: {
      sortable: true,
    },
  });
}

export const directoryPageType = defineType({
  name: "directoryPage",
  title: "Directory Page",
  type: "document",
  fields: [
    defineField({
      name: "heroTitle",
      title: "Hero title",
      type: "string",
      initialValue: "Find a Bipolar Disorder Specialist",
    }),
    defineField({
      name: "heroDescription",
      title: "Hero description",
      type: "text",
      rows: 3,
      initialValue:
        "Browse verified therapists and psychiatrists who specialize in bipolar spectrum disorders",
    }),
    defineField({
      name: "searchPanelTitle",
      title: "Search panel title",
      type: "string",
      initialValue: "Search",
    }),
    defineField({
      name: "searchLabel",
      title: "Keyword label",
      type: "string",
      initialValue: "Keywords",
    }),
    defineField({
      name: "searchPlaceholder",
      title: "Keyword placeholder",
      type: "string",
      initialValue: "Name, specialty, approach...",
    }),
    defineField({
      name: "locationPanelTitle",
      title: "Location panel title",
      type: "string",
      initialValue: "Location",
    }),
    defineField({
      name: "stateLabel",
      title: "State label",
      type: "string",
      initialValue: "State",
    }),
    defineField({
      name: "stateAllLabel",
      title: "All states label",
      type: "string",
      initialValue: "All States",
    }),
    defineField({
      name: "cityLabel",
      title: "City label",
      type: "string",
      initialValue: "City",
    }),
    defineField({
      name: "cityPlaceholder",
      title: "City placeholder",
      type: "string",
      initialValue: "e.g. Chicago",
    }),
    defineField({
      name: "specialtyPanelTitle",
      title: "Specialty panel title",
      type: "string",
      initialValue: "Specialty",
    }),
    defineField({
      name: "specialtyLabel",
      title: "Specialty label",
      type: "string",
      initialValue: "Focus Area",
    }),
    defineField({
      name: "specialtyAllLabel",
      title: "All specialties label",
      type: "string",
      initialValue: "All Specialties",
    }),
    defineField({
      name: "insurancePanelTitle",
      title: "Insurance panel title",
      type: "string",
      initialValue: "Insurance",
    }),
    defineField({
      name: "insuranceLabel",
      title: "Insurance label",
      type: "string",
      initialValue: "Accepted Insurance",
    }),
    defineField({
      name: "insuranceAllLabel",
      title: "All insurance label",
      type: "string",
      initialValue: "All Insurance",
    }),
    defineField({
      name: "optionsPanelTitle",
      title: "Options panel title",
      type: "string",
      initialValue: "Options",
    }),
    defineField({
      name: "telehealthLabel",
      title: "Telehealth checkbox label",
      type: "string",
      initialValue: "Telehealth Available",
    }),
    defineField({
      name: "inPersonLabel",
      title: "In-person checkbox label",
      type: "string",
      initialValue: "In-Person Available",
    }),
    defineField({
      name: "acceptingLabel",
      title: "Accepting patients checkbox label",
      type: "string",
      initialValue: "Accepting New Patients",
    }),
    defineField({
      name: "applyButtonLabel",
      title: "Apply button label",
      type: "string",
      initialValue: "Apply Filters",
    }),
    defineField({
      name: "resetButtonLabel",
      title: "Reset button label",
      type: "string",
      initialValue: "Reset All",
    }),
    defineField({
      name: "resultsSuffix",
      title: "Results suffix",
      type: "string",
      description: 'Text used after the count, for example "specialists found".',
      initialValue: "specialists found",
    }),
    defineField({
      name: "emptyStateTitle",
      title: "Empty state title",
      type: "string",
      initialValue: "No therapists found",
    }),
    defineField({
      name: "emptyStateDescription",
      title: "Empty state description",
      type: "text",
      rows: 2,
      initialValue: "Try adjusting your filters or search terms.",
    }),
    optionArrayField("curatedStates", "Curated state options"),
    optionArrayField("curatedSpecialties", "Curated specialty options"),
    optionArrayField("curatedInsurance", "Curated insurance options"),
  ],
  preview: {
    prepare: () => ({
      title: "Directory Page",
    }),
  },
});
