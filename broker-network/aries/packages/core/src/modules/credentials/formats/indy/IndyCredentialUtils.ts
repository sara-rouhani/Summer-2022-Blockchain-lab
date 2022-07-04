import type { LinkedAttachment } from '../../../../utils/LinkedAttachment'
import type { CredValues, Schema } from 'indy-sdk'

import BigNumber from 'bn.js'

import { AriesFrameworkError } from '../../../../error/AriesFrameworkError'
import { Hasher } from '../../../../utils'
import { encodeAttachment } from '../../../../utils/attachment'
import { Buffer } from '../../../../utils/buffer'
import { isBoolean, isNumber, isString } from '../../../../utils/type'
import { CredentialPreviewAttribute } from '../../models/CredentialPreviewAttribute'

export class IndyCredentialUtils {
  /**
   * Adds attribute(s) to the credential preview that is linked to the given attachment(s)
   *
   * @param attachments a list of the attachments that need to be linked to a credential
   * @param preview the credential previews where the new linked credential has to be appended to
   *
   * @returns a modified version of the credential preview with the linked credentials
   * */
  public static createAndLinkAttachmentsToPreview(
    attachments: LinkedAttachment[],
    previewAttributes: CredentialPreviewAttribute[]
  ) {
    const credentialPreviewAttributeNames = previewAttributes.map((attribute) => attribute.name)
    const newPreviewAttributes = [...previewAttributes]

    attachments.forEach((linkedAttachment) => {
      if (credentialPreviewAttributeNames.includes(linkedAttachment.attributeName)) {
        throw new AriesFrameworkError(
          `linkedAttachment ${linkedAttachment.attributeName} already exists in the preview`
        )
      } else {
        const credentialPreviewAttribute = new CredentialPreviewAttribute({
          name: linkedAttachment.attributeName,
          mimeType: linkedAttachment.attachment.mimeType,
          value: encodeAttachment(linkedAttachment.attachment),
        })
        newPreviewAttributes.push(credentialPreviewAttribute)
      }
    })

    return newPreviewAttributes
  }

  /**
   * Converts int value to string
   * Converts string value:
   * - hash with sha256,
   * - convert to byte array and reverse it
   * - convert it to BigInteger and return as a string
   * @param attributes
   *
   * @returns CredValues
   */
  public static convertAttributesToValues(attributes: CredentialPreviewAttribute[]): CredValues {
    return attributes.reduce((credentialValues, attribute) => {
      return {
        [attribute.name]: {
          raw: attribute.value,
          encoded: IndyCredentialUtils.encode(attribute.value),
        },
        ...credentialValues,
      }
    }, {})
  }

  /**
   * Check whether the values of two credentials match (using {@link assertValuesMatch})
   *
   * @returns a boolean whether the values are equal
   *
   */
  public static checkValuesMatch(firstValues: CredValues, secondValues: CredValues): boolean {
    try {
      this.assertValuesMatch(firstValues, secondValues)
      return true
    } catch {
      return false
    }
  }

  /**
   * Assert two credential values objects match.
   *
   * @param firstValues The first values object
   * @param secondValues The second values object
   *
   * @throws If not all values match
   */
  public static assertValuesMatch(firstValues: CredValues, secondValues: CredValues) {
    const firstValuesKeys = Object.keys(firstValues)
    const secondValuesKeys = Object.keys(secondValues)

    if (firstValuesKeys.length !== secondValuesKeys.length) {
      throw new Error(
        `Number of values in first entry (${firstValuesKeys.length}) does not match number of values in second entry (${secondValuesKeys.length})`
      )
    }

    for (const key of firstValuesKeys) {
      const firstValue = firstValues[key]
      const secondValue = secondValues[key]

      if (!secondValue) {
        throw new Error(`Second cred values object has no value for key '${key}'`)
      }

      if (firstValue.encoded !== secondValue.encoded) {
        throw new Error(`Encoded credential values for key '${key}' do not match`)
      }

      if (firstValue.raw !== secondValue.raw) {
        throw new Error(`Raw credential values for key '${key}' do not match`)
      }
    }
  }

  /**
   * Check whether the raw value matches the encoded version according to the encoding format described in Aries RFC 0037
   * Use this method to ensure the received proof (over the encoded) value is the same as the raw value of the data.
   *
   * @param raw
   * @param encoded
   * @returns Whether raw and encoded value match
   *
   * @see https://github.com/hyperledger/aries-framework-dotnet/blob/a18bef91e5b9e4a1892818df7408e2383c642dfa/src/Hyperledger.Aries/Utils/CredentialUtils.cs#L78-L89
   * @see https://github.com/hyperledger/aries-rfcs/blob/be4ad0a6fb2823bb1fc109364c96f077d5d8dffa/features/0037-present-proof/README.md#verifying-claims-of-indy-based-verifiable-credentials
   */
  public static checkValidEncoding(raw: unknown, encoded: string) {
    return encoded === IndyCredentialUtils.encode(raw)
  }

  /**
   * Encode value according to the encoding format described in Aries RFC 0036/0037
   *
   * @param value
   * @returns Encoded version of value
   *
   * @see https://github.com/hyperledger/aries-cloudagent-python/blob/0000f924a50b6ac5e6342bff90e64864672ee935/aries_cloudagent/messaging/util.py#L106-L136
   * @see https://github.com/hyperledger/aries-rfcs/blob/be4ad0a6fb2823bb1fc109364c96f077d5d8dffa/features/0037-present-proof/README.md#verifying-claims-of-indy-based-verifiable-credentials
   * @see https://github.com/hyperledger/aries-rfcs/blob/be4ad0a6fb2823bb1fc109364c96f077d5d8dffa/features/0036-issue-credential/README.md#encoding-claims-for-indy-based-verifiable-credentials
   */
  public static encode(value: unknown) {
    const isEmpty = (value: unknown) => isString(value) && value === ''

    // If bool return bool as number string
    if (isBoolean(value)) {
      return Number(value).toString()
    }

    // If value is int32 return as number string
    if (isNumber(value) && this.isInt32(value)) {
      return value.toString()
    }

    // If value is an int32 number string return as number string
    if (isString(value) && !isEmpty(value) && !isNaN(Number(value)) && this.isInt32(Number(value))) {
      return Number(value).toString()
    }

    if (isNumber(value)) {
      value = value.toString()
    }

    // If value is null we must use the string value 'None'
    if (value === null || value === undefined) {
      value = 'None'
    }

    return new BigNumber(Hasher.hash(Buffer.from(value as string), 'sha2-256')).toString()
  }

  public static checkAttributesMatch(schema: Schema, attributes: CredentialPreviewAttribute[]) {
    const schemaAttributes = schema.attrNames
    const credAttributes = attributes.map((a) => a.name)

    const difference = credAttributes
      .filter((x) => !schemaAttributes.includes(x))
      .concat(schemaAttributes.filter((x) => !credAttributes.includes(x)))

    if (difference.length > 0) {
      throw new AriesFrameworkError(
        `The credential preview attributes do not match the schema attributes (difference is: ${difference}, needs: ${schemaAttributes})`
      )
    }
  }

  private static isInt32(number: number) {
    const minI32 = -2147483648
    const maxI32 = 2147483647

    // Check if number is integer and in range of int32
    return Number.isInteger(number) && number >= minI32 && number <= maxI32
  }
}
