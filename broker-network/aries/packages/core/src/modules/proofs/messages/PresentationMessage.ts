import type { IndyProof } from 'indy-sdk'

import { Expose, Type } from 'class-transformer'
import { IsArray, IsString, ValidateNested, IsOptional, IsInstance } from 'class-validator'

import { AgentMessage } from '../../../agent/AgentMessage'
import { Attachment } from '../../../decorators/attachment/Attachment'
import { IsValidMessageType, parseMessageType } from '../../../utils/messageType'

export const INDY_PROOF_ATTACHMENT_ID = 'libindy-presentation-0'

export interface PresentationOptions {
  id?: string
  comment?: string
  presentationAttachments: Attachment[]
  attachments?: Attachment[]
}

/**
 * Presentation Message part of Present Proof Protocol used as a response to a {@link PresentationRequestMessage | Presentation Request Message} from prover to verifier.
 * Contains signed presentations.
 *
 * @see https://github.com/hyperledger/aries-rfcs/blob/master/features/0037-present-proof/README.md#presentation
 */
export class PresentationMessage extends AgentMessage {
  public constructor(options: PresentationOptions) {
    super()

    if (options) {
      this.id = options.id ?? this.generateId()
      this.comment = options.comment
      this.presentationAttachments = options.presentationAttachments
      this.appendedAttachments = options.attachments
    }
  }

  @IsValidMessageType(PresentationMessage.type)
  public readonly type = PresentationMessage.type.messageTypeUri
  public static readonly type = parseMessageType('https://didcomm.org/present-proof/1.0/presentation')

  /**
   *  Provides some human readable information about this request for a presentation.
   */
  @IsOptional()
  @IsString()
  public comment?: string

  /**
   * An array of attachments containing the presentation in the requested format(s).
   */
  @Expose({ name: 'presentations~attach' })
  @Type(() => Attachment)
  @IsArray()
  @ValidateNested({
    each: true,
  })
  @IsInstance(Attachment, { each: true })
  public presentationAttachments!: Attachment[]

  public get indyProof(): IndyProof | null {
    const attachment = this.presentationAttachments.find((attachment) => attachment.id === INDY_PROOF_ATTACHMENT_ID)

    const proofJson = attachment?.getDataAsJson<IndyProof>() ?? null

    return proofJson
  }
}
