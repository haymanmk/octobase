import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // * matches all URLs, the ? makes it optional so it will match / as well
  route("*?", "./app/catchall.tsx"),
  layout("./app/layout.tsx", [
    index("./app/whiteboard.tsx"),
    // route("about", "./app/about.tsx"),
    // route("contact", "./app/contact.tsx"),
  ]),
] satisfies RouteConfig;
