"use client";

import {
  ProjectPhotoAssetPreviewLightbox,
  type ProjectPhotoAssetPreviewLightboxProps,
} from "@/components/projects/project-photo-asset-preview-lightbox";
import { ProjectVideoAssetPreviewLightbox } from "@/components/projects/project-video-asset-preview-lightbox";

type SharedProjectAssetPreviewLightboxProps = Omit<
  ProjectPhotoAssetPreviewLightboxProps,
  "asset"
>;

type PhotoAssetPreview = ProjectPhotoAssetPreviewLightboxProps["asset"];

type VideoAssetPreview = {
  id: string;
  assetType: "video";
  originalFilename: string;
  playbackUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
};

export type ProjectAssetPreviewLightboxProps = SharedProjectAssetPreviewLightboxProps & {
  asset: PhotoAssetPreview | VideoAssetPreview;
};

export function ProjectAssetPreviewLightbox(props: ProjectAssetPreviewLightboxProps) {
  if (props.asset.assetType === "video") {
    return <ProjectVideoAssetPreviewLightbox {...props} asset={props.asset} />;
  }

  return <ProjectPhotoAssetPreviewLightbox {...props} asset={props.asset} />;
}
