/**
 * Realistic Form 4 ownershipDocument fixture used by parser unit tests and
 * the ingestion integration test. Fictional filing, real structure:
 * Table I with an open-market sale (10b5-1) and an indirect purchase,
 * Table II with an RSU conversion, a holdings row that must be ignored,
 * and referenced footnotes.
 */
export const SAMPLE_FORM4_XML = `<?xml version="1.0"?>
<ownershipDocument>
    <schemaVersion>X0508</schemaVersion>
    <documentType>4</documentType>
    <periodOfReport>2026-07-30</periodOfReport>
    <notSubjectToSection16>0</notSubjectToSection16>
    <aff10b5One>1</aff10b5One>

    <issuer>
        <issuerCik>0000320193</issuerCik>
        <issuerName>Apple Inc.</issuerName>
        <issuerTradingSymbol>AAPL</issuerTradingSymbol>
    </issuer>

    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerCik>0001214156</rptOwnerCik>
            <rptOwnerName>Doe  Jane A.</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerAddress>
            <rptOwnerStreet1>ONE APPLE PARK WAY</rptOwnerStreet1>
            <rptOwnerCity>CUPERTINO</rptOwnerCity>
            <rptOwnerState>CA</rptOwnerState>
            <rptOwnerZipCode>95014</rptOwnerZipCode>
        </reportingOwnerAddress>
        <reportingOwnerRelationship>
            <isDirector>1</isDirector>
            <isOfficer>1</isOfficer>
            <isTenPercentOwner>0</isTenPercentOwner>
            <isOther>0</isOther>
            <officerTitle>Chief Financial Officer</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>

    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <securityTitle>
                <value>Common Stock</value>
            </securityTitle>
            <transactionDate>
                <value>2026-07-30</value>
            </transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>S</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
                <footnoteId id="F1"/>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares>
                    <value>10000</value>
                </transactionShares>
                <transactionPricePerShare>
                    <value>228.4501</value>
                    <footnoteId id="F2"/>
                </transactionPricePerShare>
                <transactionAcquiredDisposedCode>
                    <value>D</value>
                </transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction>
                    <value>150000</value>
                </sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership>
                    <value>D</value>
                </directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <securityTitle>
                <value>Common Stock</value>
            </securityTitle>
            <transactionDate>
                <value>2026-07-29</value>
            </transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>P</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares>
                    <value>2500</value>
                </transactionShares>
                <transactionPricePerShare>
                    <value>226.10</value>
                </transactionPricePerShare>
                <transactionAcquiredDisposedCode>
                    <value>A</value>
                </transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction>
                    <value>42500</value>
                </sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership>
                    <value>I</value>
                </directOrIndirectOwnership>
                <natureOfOwnership>
                    <value>By Family Trust</value>
                    <footnoteId id="F3"/>
                </natureOfOwnership>
            </ownershipNature>
        </nonDerivativeTransaction>
        <nonDerivativeHolding>
            <securityTitle>
                <value>Restricted Stock Units</value>
            </securityTitle>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction>
                    <value>80000</value>
                </sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership>
                    <value>D</value>
                </directOrIndirectOwnership>
            </ownershipNature>
        </nonDerivativeHolding>
    </nonDerivativeTable>

    <derivativeTable>
        <derivativeTransaction>
            <securityTitle>
                <value>Restricted Stock Unit</value>
            </securityTitle>
            <transactionDate>
                <value>2026-07-30</value>
            </transactionDate>
            <transactionCoding>
                <transactionFormType>4</transactionFormType>
                <transactionCode>M</transactionCode>
                <equitySwapInvolved>0</equitySwapInvolved>
            </transactionCoding>
            <transactionAmounts>
                <transactionShares>
                    <value>2000</value>
                </transactionShares>
                <transactionPricePerShare>
                    <value>0</value>
                </transactionPricePerShare>
                <transactionAcquiredDisposedCode>
                    <value>D</value>
                </transactionAcquiredDisposedCode>
            </transactionAmounts>
            <exerciseDate>
                <footnoteId id="F4"/>
            </exerciseDate>
            <underlyingSecurity>
                <underlyingSecurityTitle>
                    <value>Common Stock</value>
                </underlyingSecurityTitle>
                <underlyingSecurityShares>
                    <value>2000</value>
                </underlyingSecurityShares>
            </underlyingSecurity>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction>
                    <value>78000</value>
                </sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
            <ownershipNature>
                <directOrIndirectOwnership>
                    <value>D</value>
                </directOrIndirectOwnership>
            </ownershipNature>
        </derivativeTransaction>
    </derivativeTable>

    <footnotes>
        <footnote id="F1">Transaction effected pursuant to a Rule 10b5-1 trading plan adopted by the reporting person on March 15, 2026.</footnote>
        <footnote id="F2">Weighted average sale price. Prices ranged from $227.90 to $229.00. Full information available upon request.</footnote>
        <footnote id="F3">Shares held by the Doe Family Trust, of which the reporting person is trustee.</footnote>
        <footnote id="F4">Restricted stock units convert into common stock on a one-for-one basis upon vesting.</footnote>
    </footnotes>

    <ownerSignature>
        <signatureName>/s/ Jane A. Doe, by power of attorney</signatureName>
        <signatureDate>2026-07-31</signatureDate>
    </ownerSignature>
</ownershipDocument>`;

/** Wrap the ownership XML the way a complete EDGAR submission .txt embeds it. */
export function wrapAsSubmissionText(
  ownershipXml: string,
  acceptanceDatetime = "20260731170512",
): string {
  return [
    "<SEC-DOCUMENT>0000320193-26-000123.txt : 20260731",
    `<ACCEPTANCE-DATETIME>${acceptanceDatetime}`,
    "ACCESSION NUMBER:\t\t0000320193-26-000123",
    "CONFORMED SUBMISSION TYPE:\t4",
    "<DOCUMENT>",
    "<TYPE>4",
    "<SEQUENCE>1",
    "<FILENAME>wk-form4_1753999999.xml",
    "<TEXT>",
    "<XML>",
    ownershipXml,
    "</XML>",
    "</TEXT>",
    "</DOCUMENT>",
    "</SEC-DOCUMENT>",
  ].join("\n");
}
