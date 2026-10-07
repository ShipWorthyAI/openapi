import ts from "#compiler";
const DATE = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Date"));

export default {
  transform(schemaObject) {
    if ("format" in schemaObject && schemaObject.format === "date-time")
      return {
        schema: DATE,
        questionToken: !0,
      };
  },
};
