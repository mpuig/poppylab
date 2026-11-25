import { Workspace } from "../workspace";

/**
 * One conversation, named by its ID. The page reads the ID from the address
 * and asks the server for it; only the visitor who started it gets it back.
 */
export default function ConversationPage() {
  return <Workspace />;
}
