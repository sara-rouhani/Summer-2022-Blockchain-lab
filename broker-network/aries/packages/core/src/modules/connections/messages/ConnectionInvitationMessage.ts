import { Transform } from 'class-transformer'
import { ArrayNotEmpty, IsArray, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator'
import { parseUrl } from 'query-string'

import { AgentMessage } from '../../../agent/AgentMessage'
import { AriesFrameworkError } from '../../../error'
import { JsonEncoder } from '../../../utils/JsonEncoder'
import { JsonTransformer } from '../../../utils/JsonTransformer'
import { MessageValidator } from '../../../utils/MessageValidator'
import { IsValidMessageType, parseMessageType, replaceLegacyDidSovPrefix } from '../../../utils/messageType'

export interface BaseInvitationOptions {
  id?: string
  label: string
  imageUrl?: string
}

export interface InlineInvitationOptions {
  recipientKeys: string[]
  serviceEndpoint: string
  routingKeys?: string[]
}

export interface DIDInvitationOptions {
  did: string
}

/**
 * Message to invite another agent to create a connection
 *
 * @see https://github.com/hyperledger/aries-rfcs/blob/master/features/0160-connection-protocol/README.md#0-invitation-to-connect
 */
export class ConnectionInvitationMessage extends AgentMessage {
  /**
   * Create new ConnectionInvitationMessage instance.
   * @param options
   */
  public constructor(options: BaseInvitationOptions & (DIDInvitationOptions | InlineInvitationOptions)) {
    super()

    if (options) {
      this.id = options.id || this.generateId()
      this.label = options.label
      this.imageUrl = options.imageUrl

      if (isDidInvitation(options)) {
        this.did = options.did
      } else {
        this.recipientKeys = options.recipientKeys
        this.serviceEndpoint = options.serviceEndpoint
        this.routingKeys = options.routingKeys
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      if (options.did && (options.recipientKeys || options.routingKeys || options.serviceEndpoint)) {
        throw new AriesFrameworkError(
          'either the did or the recipientKeys/serviceEndpoint/routingKeys must be set, but not both'
        )
      }
    }
  }

  @IsValidMessageType(ConnectionInvitationMessage.type)
  @Transform(({ value }) => replaceLegacyDidSovPrefix(value), {
    toClassOnly: true,
  })
  public readonly type = ConnectionInvitationMessage.type.messageTypeUri
  public static readonly type = parseMessageType('https://didcomm.org/connections/1.0/invitation')

  @IsString()
  public label!: string

  @IsString()
  @ValidateIf((o: ConnectionInvitationMessage) => o.recipientKeys === undefined)
  public did?: string

  @IsString({
    each: true,
  })
  @IsArray()
  @ValidateIf((o: ConnectionInvitationMessage) => o.did === undefined)
  @ArrayNotEmpty()
  public recipientKeys?: string[]

  @IsString()
  @ValidateIf((o: ConnectionInvitationMessage) => o.did === undefined)
  public serviceEndpoint?: string

  @IsString({
    each: true,
  })
  @ValidateIf((o: ConnectionInvitationMessage) => o.did === undefined)
  @IsOptional()
  public routingKeys?: string[]

  @IsOptional()
  @IsUrl()
  public imageUrl?: string

  /**
   * Create an invitation url from this instance
   *
   * @param domain domain name to use for invitation url
   * @returns invitation url with base64 encoded invitation
   */
  public toUrl({ domain, useLegacyDidSovPrefix = false }: { domain: string; useLegacyDidSovPrefix?: boolean }) {
    const invitationJson = this.toJSON({ useLegacyDidSovPrefix })

    const encodedInvitation = JsonEncoder.toBase64URL(invitationJson)
    const invitationUrl = `${domain}?c_i=${encodedInvitation}`

    return invitationUrl
  }

  /**
   * Create a `ConnectionInvitationMessage` instance from the `c_i` or `d_m` parameter of an URL
   *
   * @param invitationUrl invitation url containing c_i or d_m parameter
   *
   * @throws Error when url can not be decoded to JSON, or decoded message is not a valid `ConnectionInvitationMessage`
   * @throws Error when the url does not contain c_i or d_m as parameter
   */
  public static async fromUrl(invitationUrl: string) {
    const parsedUrl = parseUrl(invitationUrl).query
    const encodedInvitation = parsedUrl['c_i'] ?? parsedUrl['d_m']

    if (typeof encodedInvitation === 'string') {
      const invitationJson = JsonEncoder.fromBase64(encodedInvitation)
      const invitation = JsonTransformer.fromJSON(invitationJson, ConnectionInvitationMessage)

      await MessageValidator.validate(invitation)

      return invitation
    } else {
      throw new AriesFrameworkError(
        'InvitationUrl is invalid. It needs to contain one, and only one, of the following parameters; `c_i` or `d_m`'
      )
    }
  }
}

/**
 * Check whether an invitation is a `DIDInvitationData` object
 *
 * @param invitation invitation object
 */
function isDidInvitation(
  invitation: InlineInvitationOptions | DIDInvitationOptions
): invitation is DIDInvitationOptions {
  return (invitation as DIDInvitationOptions).did !== undefined
}
