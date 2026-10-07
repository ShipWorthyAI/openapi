import ts from "#compiler";
const BLOB = ts.factory.createTypeReferenceNode("Blob");

export default {
  transform(schemaObject) {
    if (schemaObject.format === "binary")
      return {
        schema: BLOB,
        questionToken: !0,
      };
  },
};
