import ts from "#compiler";
import { NULL } from "../../../../src/lib/ts.js";
const DATE = ts.factory.createTypeReferenceNode(ts.factory.createIdentifier("Date"));

export default {
  transform(schemaObject) {
    if (schemaObject.format === "date-time")
      return {
        schema: ts.factory.createUnionTypeNode([DATE, NULL]),
        questionToken: !0,
      };
  },
};
