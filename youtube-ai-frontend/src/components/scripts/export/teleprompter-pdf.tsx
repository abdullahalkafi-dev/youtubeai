'use client'

import React from 'react'
import { Document, Page, Text, View, StyleSheet, Font, Svg, Polygon, pdf } from '@react-pdf/renderer'
import { parseScriptSections } from '@/lib/teleprompter-parser'

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 45,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    backgroundColor: '#FFFFFF',
    color: '#111827',
  },
  header: {
    position: 'absolute',
    top: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingBottom: 6,
  },
  headerTitle: {
    fontSize: 9,
    color: '#4B5563',
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
  },
  headerStats: {
    fontSize: 9,
    color: '#6B7280',
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 6,
  },
  footerBrand: {
    fontSize: 8,
    color: '#9CA3AF',
  },
  pageNumber: {
    fontSize: 8,
    color: '#9CA3AF',
  },
  titleBlock: {
    marginBottom: 20,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
  },
  mainTitle: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  metaSubtitle: {
    fontSize: 10,
    color: '#6B7280',
  },
  sectionContainer: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#1F2937',
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    textTransform: 'uppercase',
  },
  leadThought: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 6,
    lineHeight: 1.4,
  },
  spokenLine: {
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: '#374151',
    marginBottom: 6,
    paddingLeft: 12,
    lineHeight: 1.5,
    borderLeftWidth: 2,
    borderLeftColor: '#D1D5DB',
  },
  cueBadge: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#4B5563',
    backgroundColor: '#F3F4F6',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  jewelBox: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 6,
    padding: 10,
    marginVertical: 10,
  },
  jewelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  jewelHeader: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: '#B45309',
    textTransform: 'uppercase',
  },
  jewelText: {
    fontSize: 10,
    color: '#92400E',
    lineHeight: 1.4,
  },
})

interface TeleprompterPdfDocProps {
  title: string;
  content: string;
  wordCount: number;
  estimatedDurationMinutes: number;
}

export const TeleprompterPdfDocument: React.FC<TeleprompterPdfDocProps> = ({
  title,
  content,
  wordCount,
  estimatedDurationMinutes,
}) => {
  const sections = parseScriptSections(content)

  return (
    <Document title={title} author="YouTube AI Studio">
      <Page size="A4" style={styles.page} wrap>
        {/* Repeating Header */}
        <View style={styles.header} fixed>
          <Text style={styles.headerTitle}>{title.length > 45 ? `${title.slice(0, 45)}...` : title}</Text>
          <Text style={styles.headerStats}>{estimatedDurationMinutes} min read · {wordCount} words</Text>
        </View>

        {/* Title Block */}
        <View style={styles.titleBlock}>
          <Text style={styles.mainTitle}>{title}</Text>
          <Text style={styles.metaSubtitle}>
            YouTube AI Teleprompter Script · {estimatedDurationMinutes} min read ({wordCount} words) · {new Date().toLocaleDateString()}
          </Text>
        </View>

        {/* Sections */}
        {sections.map((section, idx) => (
          <View key={idx} style={styles.sectionContainer} wrap={true}>
            {section.header && (
              <Text style={styles.sectionHeader} wrap={false}>{section.header}</Text>
            )}

            {section.isJewel ? (
              <View style={styles.jewelBox} wrap={false}>
                <View style={styles.jewelHeaderRow}>
                  <Svg width={10} height={10} viewBox="0 0 24 24">
                    <Polygon points="6 3, 18 3, 22 9, 12 21, 2 9" fill="#D97706" />
                  </Svg>
                  <Text style={styles.jewelHeader}>JEWEL TAKEAWAY</Text>
                </View>
                <Text style={styles.jewelText}>
                  {section.body.replace(/^>\s*/gm, '').replace(/\*\*/g, '').replace(/💎\s*/g, '')}
                </Text>
              </View>
            ) : (
              <View wrap={true}>
                {section.body.split('\n').map((line, lIdx) => {
                  const trimmed = line.trim()
                  if (!trimmed) return null

                  if (trimmed.startsWith('[BEAT]') || trimmed.startsWith('[PAUSE]')) {
                    return (
                      <Text key={lIdx} style={styles.cueBadge} wrap={false}>
                        {trimmed}
                      </Text>
                    )
                  }

                  if (trimmed.startsWith('•') || trimmed.startsWith('**•') || trimmed.startsWith('**➤')) {
                    return (
                      <Text key={lIdx} style={styles.leadThought} wrap={false}>
                        {trimmed.replace(/\*\*/g, '')}
                      </Text>
                    )
                  }

                  return (
                    <Text key={lIdx} style={styles.spokenLine} wrap={false}>
                      {trimmed.replace(/^>\s*/, '').replace(/\*\*/g, '')}
                    </Text>
                  )
                })}
              </View>
            )}
          </View>
        ))}

        {/* Repeating Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerBrand}>YouTube AI Teleprompter Studio</Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

export async function downloadTeleprompterPdf(
  title: string,
  content: string,
  wordCount: number,
  estimatedDurationMinutes: number,
) {
  const blob = await pdf(
    <TeleprompterPdfDocument
      title={title}
      content={content}
      wordCount={wordCount}
      estimatedDurationMinutes={estimatedDurationMinutes}
    />
  ).toBlob()

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-teleprompter.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
