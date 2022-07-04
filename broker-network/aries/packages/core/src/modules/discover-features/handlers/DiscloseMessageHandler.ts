import type { Handler, HandlerInboundMessage } from '../../../agent/Handler'

import { DiscloseMessage } from '../messages'

export class DiscloseMessageHandler implements Handler {
  public supportedMessages = [DiscloseMessage]

  public async handle(inboundMessage: HandlerInboundMessage<DiscloseMessageHandler>) {
    // We don't really need to do anything with this at the moment
    // The result can be hooked into through the generic message processed event
    inboundMessage.assertReadyConnection()
  }
}
