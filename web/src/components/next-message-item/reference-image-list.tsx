/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import Image, { useDocumentImageUrl } from '@/components/image';
import FileIcon from '@/components/file-icon';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { useSetModalState } from '@/hooks/common-hooks';
import { IReferenceChunk } from '@/interfaces/database/chat';
import PdfDrawer from '@/pages/next-search/document-preview-modal';
import { middleEllipsis } from '@/utils/common-util';
import { RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo } from 'react';
import { PhotoProvider, PhotoView } from 'react-photo-view';
import { ReferenceImageItem, buildReferenceImages } from './utils';

type IProps = {
  referenceChunks?: IReferenceChunk[] | Record<string, IReferenceChunk>;
  messageContent: string;
  /**
   * 回答里没有引用标号时，把本轮命中的文档也画成卡片（有配图用配图，没配图放
   * 文件图标）。没开「引用」的智能体（电话 IVR 不能开，标号会被 TTS 念出来）
   * 靠它才有卡片可看，否则检索命中了什么在界面上完全看不出来。
   */
  fallbackToHitDocuments?: boolean;
};

const getButtonVisibilityClass = (imageCount: number) => {
  const map: Record<number, string> = {
    1: 'hidden',
    2: '@sm:hidden',
    3: '@md:hidden',
    4: '@lg:hidden',
    5: '@lg:hidden',
  };
  return map[imageCount] || (imageCount >= 6 ? '@2xl:hidden' : '');
};

/**
 * ChunkImage renders one image extracted from a cited chunk, wrapped in
 * PhotoView so it can be zoomed. Only wraps when the image URL is ready:
 * PhotoView caches an empty src and would then show a blank preview.
 */
function ChunkImage({
  imageId,
  documentId,
  label,
  previewButton,
}: {
  imageId: string;
  documentId: string;
  label?: string;
  previewButton: React.ReactNode;
}) {
  const src = useDocumentImageUrl(imageId, documentId);
  const imageElement = (
    <Image
      id={imageId}
      documentId={documentId}
      className="h-40 w-full"
      label={label}
      previewButton={previewButton}
    />
  );

  if (!src) {
    return imageElement;
  }

  return <PhotoView src={src}>{imageElement}</PhotoView>;
}

/**
 * ImagePhotoView renders one reference card: the chunk's picture when it has
 * one, a file icon otherwise (a hit document whose chunks carry no image, which
 * is the norm for txt/xlsx sources), plus the file-name caption that opens the
 * document drawer.
 */
function ImagePhotoView({
  imageId,
  documentId,
  documentName,
  label,
}: ReferenceImageItem) {
  const { visible, showModal, hideModal } = useSetModalState();
  const previewButton = (
    <button
      type="button"
      title={documentName}
      onClick={(e) => {
        // Prevent triggering the image fullscreen preview
        e.stopPropagation();
        showModal();
      }}
      className="absolute bottom-2 left-2 flex max-w-[calc(100%-2.5rem)] items-end gap-1 rounded-md text-[11px] leading-tight "
    >
      <span className="[&>img]:h-4 [&>img]:w-4 [&>svg]:h-4 [&>svg]:w-4">
        <FileIcon id={documentId} name={documentName} width={14}></FileIcon>
      </span>
      <span className="truncate">{middleEllipsis(documentName, 10, 6)}</span>
    </button>
  );

  return (
    <div className="relative">
      {imageId ? (
        <ChunkImage
          imageId={imageId}
          documentId={documentId}
          label={label}
          previewButton={previewButton}
        />
      ) : (
        <div
          onClick={showModal}
          className="flex h-40 w-full cursor-pointer items-center justify-center rounded-md border border-border-button bg-bg-card"
        >
          <FileIcon id={documentId} name={documentName} width={44}></FileIcon>
          {previewButton}
        </div>
      )}
      {visible && (
        <PdfDrawer
          visible={visible}
          hideModal={hideModal}
          documentId={documentId}
          chunk={{ document_name: documentName }}
        ></PdfDrawer>
      )}
    </div>
  );
}

function ImageCarousel({ images }: { images: ReferenceImageItem[] }) {
  const buttonVisibilityClass = getButtonVisibilityClass(images.length);

  return (
    <PhotoProvider
      // className="[&_.PhotoView-Slider__toolbarIcon]:hidden"
      toolbarRender={({ rotate, onRotate, scale, onScale }) => {
        return (
          <>
            <RotateCw
              className="mr-4 cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onRotate(rotate + 90)}
            />
            <ZoomIn
              className="mr-4 cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onScale(scale + 1)}
            />
            <ZoomOut
              className="cursor-pointer text-text-disabled hover:text-text-primary"
              onClick={() => onScale(scale - 1)}
            />
            {/* <X className="cursor-pointer text-text-disabled hover:text-text-primary" /> */}
          </>
        );
      }}
    >
      <Carousel
        className="w-full"
        opts={{
          align: 'start',
        }}
      >
        <CarouselContent>
          {images.map((item) => (
            <CarouselItem
              key={item.key}
              className="
              basis-full
              @sm:basis-1/2
              @md:basis-1/3
              @lg:basis-1/4
              @2xl:basis-1/6
              "
            >
              <ImagePhotoView {...item}></ImagePhotoView>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className={buttonVisibilityClass} />
        <CarouselNext className={buttonVisibilityClass} />
      </Carousel>
    </PhotoProvider>
  );
}

export function ReferenceImageList({
  referenceChunks,
  messageContent,
  fallbackToHitDocuments = false,
}: IProps) {
  const images = useMemo(
    () =>
      buildReferenceImages(referenceChunks, messageContent, {
        fallbackToHitDocuments,
      }),
    [fallbackToHitDocuments, messageContent, referenceChunks],
  );

  const imageCount = images?.length || 0;

  if (imageCount === 0) {
    return <></>;
  }

  return (
    <section className="@container w-full">
      <ImageCarousel images={images} />
    </section>
  );
}
